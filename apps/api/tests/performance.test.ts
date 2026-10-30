import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createDatabase, eq, schema, sql } from '@sitepulse/database';
import { migrateDatabase } from '@sitepulse/database/migrate';
import { parseEnvironment } from '@sitepulse/config';
import { buildApp } from '../src/app';
import {
  claimPerformanceJobs,
  finishPerformanceJob,
  reschedulePerformanceJobs,
  seedPerformanceJobs,
} from '../../worker/src/performance';
import type { PerformanceReport } from '@sitepulse/api-contracts';

const origin = 'http://localhost:3000';
let database: ReturnType<typeof createDatabase>;
let app: Awaited<ReturnType<typeof buildApp>>;
let disabledApp: typeof app;
let siteId: string;
let disconnectedId: string;
let owner: { id: string; cookie: string };
let outsider: typeof owner;
let member: typeof owner;
let unverified: typeof owner;
const report: PerformanceReport = {
  score: 0,
  analyzedAt: new Date().toISOString(),
  lighthouseVersion: '13.0.0',
  metrics: { fcpMs: 1000, lcpMs: 2000, speedIndexMs: null, tbtMs: 0, cls: 0 },
  opportunities: [],
};
const call = (
  method: 'GET' | 'POST',
  path: string,
  cookie = owner?.cookie,
  payload?: object,
) =>
  app.inject({
    method,
    url: `/api/v1${path}`,
    headers: { origin, ...(cookie ? { cookie } : {}) },
    ...(payload ? { payload } : {}),
  });
async function signup(name: string) {
  const response = await call('POST', '/auth/register', '', {
    email: `${name}@example.com`,
    name,
    password: 'performance fixture passphrase',
  });
  expect(response.statusCode, response.body).toBe(201);
  return {
    id: response.json().user.id as string,
    cookie: response.cookies.map((c) => `${c.name}=${c.value}`).join('; '),
  };
}
beforeAll(async () => {
  const url = process.env.TEST_DATABASE_URL;
  if (!url || !decodeURIComponent(new URL(url).pathname).endsWith('_test'))
    throw new Error('Dedicated _test database required');
  database = createDatabase(url);
  await migrateDatabase(database.db);
  await database.db.execute(sql`TRUNCATE users CASCADE`);
  const env = parseEnvironment({
    NODE_ENV: 'test',
    DATABASE_URL: url,
    APP_ORIGIN: origin,
    BETTER_AUTH_SECRET: randomBytes(48).toString('base64url'),
    LOG_LEVEL: 'silent',
    PERFORMANCE_ENABLED: 'true',
    PAGESPEED_API_KEY: 'fixture_key_123456789012345',
  });
  app = await buildApp({
    db: database.db,
    env,
    sendAuthMail: async () => {},
    resolveHost: async () => ['8.8.8.8'],
  });
  disabledApp = await buildApp({
    db: database.db,
    env: { ...env, PERFORMANCE_ENABLED: false },
    sendAuthMail: async () => {},
  });
  owner = await signup('performance-owner');
  outsider = await signup('performance-outsider');
  member = await signup('performance-member');
  unverified = await signup('performance-unverified');
  await database.db
    .update(schema.users)
    .set({ emailVerified: true, emailVerifiedAt: new Date() })
    .where(
      sql`${schema.users.id} in (${owner.id}, ${outsider.id}, ${member.id})`,
    );
  const organization = await call('POST', '/organizations', owner.cookie, {
    name: 'Performance',
    slug: 'performance',
  });
  expect(organization.statusCode, organization.body).toBe(201);
  const organizationId = organization.json().organization.id as string;
  await database.db.insert(schema.organizationMembers).values([
    { organizationId, userId: member.id, role: 'member' },
    { organizationId, userId: unverified.id, role: 'admin' },
  ]);
  const sites = await database.db
    .insert(schema.sites)
    .values([
      {
        organizationId,
        name: 'Connected',
        canonicalUrl: 'https://example.com/',
        hostname: 'example.com',
        status: 'active',
      },
      {
        organizationId,
        name: 'Disconnected',
        canonicalUrl: 'https://other.example.com/',
        hostname: 'other.example.com',
        status: 'disconnected',
      },
    ])
    .returning();
  siteId = sites[0]!.id;
  disconnectedId = sites[1]!.id;
  await database.db
    .insert(schema.siteCredentials)
    .values({ siteId, credentialHash: randomBytes(32).toString('hex') });
});
afterAll(async () => {
  await app?.close();
  await disabledApp?.close();
  await database?.pool.end();
});
it('enforces tenant membership, verified management, origin, strict bodies and feature switch', async () => {
  const path = `/sites/${siteId}/performance`;
  expect((await call('GET', path, '')).statusCode).toBe(401);
  expect((await call('GET', path, outsider.cookie)).statusCode).toBe(404);
  expect(
    (await call('GET', `/sites/${randomUUID()}/performance`)).statusCode,
  ).toBe(404);
  expect((await call('GET', path, member.cookie)).statusCode).toBe(200);
  for (const user of [member, unverified])
    expect(
      (await call('POST', `${path}/refresh`, user.cookie, {})).statusCode,
    ).toBe(403);
  expect(
    (
      await app.inject({
        method: 'POST',
        url: `/api/v1${path}/refresh`,
        headers: { cookie: owner.cookie },
        payload: {},
      })
    ).statusCode,
  ).toBe(403);
  expect(
    (
      await call('POST', `${path}/refresh`, owner.cookie, {
        url: 'http://127.0.0.1',
      })
    ).statusCode,
  ).toBe(400);
  expect(
    (
      await call(
        'POST',
        `/sites/${disconnectedId}/performance/refresh`,
        owner.cookie,
        {},
      )
    ).statusCode,
  ).toBe(409);
  expect(
    (
      await disabledApp.inject({
        method: 'POST',
        url: `/api/v1${path}/refresh`,
        headers: { origin, cookie: owner.cookie },
        payload: {},
      })
    ).statusCode,
  ).toBe(409);
});
it('serializes manual refresh, seeds once and reserves the shared budget across concurrent workers', async () => {
  const responses = await Promise.all([
    call('POST', `/sites/${siteId}/performance/refresh`, owner.cookie, {}),
    call('POST', `/sites/${siteId}/performance/refresh`, owner.cookie, {}),
  ]);
  expect(responses.map((r) => r.statusCode).sort()).toEqual([202, 409]);
  await seedPerformanceJobs(database.db);
  await seedPerformanceJobs(database.db);
  expect(await database.db.select().from(schema.performanceJobs)).toHaveLength(
    2,
  );
  const batches = await Promise.all([
    claimPerformanceJobs(database.db, 2),
    claimPerformanceJobs(database.db, 2),
  ]);
  const jobs = batches.flat();
  expect(jobs).toHaveLength(2);
  expect(new Set(jobs.map((j) => j.id)).size).toBe(2);
  expect(
    (await call('GET', `/sites/${siteId}/performance`))
      .json()
      .performance.devices.every(
        (d: { state: string }) => d.state === 'running',
      ),
  ).toBe(true);
  for (const job of jobs)
    expect(await finishPerformanceJob(database.db, job, { report })).toBe(true);
  const data = (await call('GET', `/sites/${siteId}/performance`)).json()
    .performance;
  expect(data.devices[0].report.score).toBe(0);
  expect(data.canRefresh).toBe(false);
  expect(data.history).toHaveLength(2);
  const [job] = await database.db.select().from(schema.performanceJobs);
  expect(job!.nextRunAt.getTime() - Date.now()).toBeGreaterThan(23 * 3600000);
  await database.db
    .update(schema.performanceJobs)
    .set({ nextRunAt: new Date(0) });
  expect(await claimPerformanceJobs(database.db, 2)).toHaveLength(0);
});
it('retains successful reports after failure, fences expired leases and disconnects', async () => {
  const jobs = await claimPerformanceJobs(database.db, 10);
  expect(jobs).toHaveLength(2);
  expect(
    await finishPerformanceJob(database.db, jobs[0]!, {
      errorCode: 'QUOTA_EXCEEDED',
    }),
  ).toBe(true);
  let data = (await call('GET', `/sites/${siteId}/performance`)).json()
    .performance;
  expect(
    data.devices.find(
      (d: { strategy: string }) => d.strategy === jobs[0]!.strategy,
    ).report.score,
  ).toBe(0);
  expect(
    data.history.some(
      (h: { errorCode: string; score: number | null }) =>
        h.errorCode === 'QUOTA_EXCEEDED' && h.score === null,
    ),
  ).toBe(true);
  await database.db
    .update(schema.performanceJobs)
    .set({ leaseExpiresAt: new Date(0) })
    .where(eq(schema.performanceJobs.id, jobs[1]!.id));
  expect(
    await finishPerformanceJob(database.db, jobs[1]!, {
      report: { ...report, score: 99 },
    }),
  ).toBe(false);
  const [reclaimed] = await claimPerformanceJobs(database.db, 10);
  expect(reclaimed?.id).toBe(jobs[1]!.id);
  expect(await finishPerformanceJob(database.db, jobs[1]!, { report })).toBe(
    false,
  );
  await database.db
    .update(schema.siteCredentials)
    .set({ revokedAt: new Date() })
    .where(eq(schema.siteCredentials.siteId, siteId));
  expect(await finishPerformanceJob(database.db, reclaimed!, { report })).toBe(
    false,
  );
  expect(await claimPerformanceJobs(database.db, 10)).toHaveLength(0);
  data = (await call('GET', `/sites/${siteId}/performance`)).json().performance;
  expect(data.available).toBe(false);
});

it('reschedules automatic checks without disturbing manual requests or active leases', async () => {
  const jobs = await database.db
    .select()
    .from(schema.performanceJobs)
    .where(eq(schema.performanceJobs.siteId, siteId));
  const attemptedAt = new Date(Date.now() - 2 * 3600_000);
  const automatic = jobs.find((job) => job.strategy === 'mobile');
  const manual = jobs.find((job) => job.strategy === 'desktop');
  expect(automatic).toBeDefined();
  expect(manual).toBeDefined();
  await database.db
    .update(schema.performanceJobs)
    .set({
      lastAttemptAt: attemptedAt,
      requestedAt: null,
      leaseExpiresAt: null,
      nextRunAt: new Date(Date.now() + 20 * 3600_000),
    })
    .where(eq(schema.performanceJobs.id, automatic!.id));
  await database.db
    .update(schema.performanceJobs)
    .set({
      lastAttemptAt: attemptedAt,
      requestedAt: new Date(attemptedAt.getTime() + 1000),
      leaseExpiresAt: null,
      nextRunAt: new Date(Date.now() + 20 * 3600_000),
    })
    .where(eq(schema.performanceJobs.id, manual!.id));
  await reschedulePerformanceJobs(database.db, 3600);
  const [rescheduled] = await database.db
    .select()
    .from(schema.performanceJobs)
    .where(eq(schema.performanceJobs.id, automatic!.id));
  const [manualPending] = await database.db
    .select()
    .from(schema.performanceJobs)
    .where(eq(schema.performanceJobs.id, manual!.id));
  expect(rescheduled!.nextRunAt.getTime()).toBeCloseTo(
    attemptedAt.getTime() + 3600_000,
    -3,
  );
  expect(manualPending!.nextRunAt.getTime()).toBeGreaterThan(
    Date.now() + 19 * 3600_000,
  );
  await database.db
    .update(schema.performanceJobs)
    .set({
      requestedAt: null,
      leaseExpiresAt: new Date(Date.now() + 60_000),
      nextRunAt: new Date(Date.now() + 20 * 3600_000),
    })
    .where(eq(schema.performanceJobs.id, manual!.id));
  await reschedulePerformanceJobs(database.db, 3600);
  const [leased] = await database.db
    .select()
    .from(schema.performanceJobs)
    .where(eq(schema.performanceJobs.id, manual!.id));
  expect(leased!.nextRunAt.getTime()).toBeGreaterThan(
    Date.now() + 19 * 3600_000,
  );
});
