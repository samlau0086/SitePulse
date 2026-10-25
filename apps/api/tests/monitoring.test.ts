import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { and, createDatabase, eq, schema, sql } from '@sitepulse/database';
import { migrateDatabase } from '@sitepulse/database/migrate';
import { parseEnvironment } from '@sitepulse/config';
import { buildApp } from '../src/app';
import {
  claimMonitorJobs,
  finishMonitorJob,
  runMonitoring,
  seedMonitorJobs,
} from '../../worker/src/monitoring';
import type { ProbeResult } from '../../worker/src/probe';
import { deliverNotificationBatch } from '../../worker/src/notifications';

const origin = 'http://localhost:3000';
const options = { MONITOR_INTERVAL_SECONDS: 900, SSL_INTERVAL_SECONDS: 86400 };
let database: ReturnType<typeof createDatabase>;
let app: Awaited<ReturnType<typeof buildApp>>;
let owner: { id: string; cookie: string };
let outsider: typeof owner;
let member: typeof owner;
let unverified: typeof owner;
let organizationId: string;
let siteId: string;
let otherSiteId: string;
const failure: ProbeResult = {
  result: 'down',
  httpStatus: 503,
  latencyMs: 15,
  errorCode: 'HTTP_STATUS',
};
const success: ProbeResult = { result: 'up', httpStatus: 200, latencyMs: 10 };
const call = (
  method: 'GET' | 'POST' | 'DELETE',
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
    password: 'monitoring test passphrase',
    name,
  });
  expect(response.statusCode, response.body).toBe(201);
  return {
    id: response.json().user.id as string,
    cookie: response.cookies.map((c) => `${c.name}=${c.value}`).join('; '),
  };
}
async function tick(
  result: ProbeResult,
  type: 'uptime' | 'ssl' = 'uptime',
  target = siteId,
) {
  await database.db
    .update(schema.monitorJobs)
    .set({ nextRunAt: new Date(0) })
    .where(
      and(
        eq(schema.monitorJobs.siteId, target),
        eq(schema.monitorJobs.monitorType, type),
      ),
    );
  const jobs = await claimMonitorJobs(database.db);
  const job = jobs.find(
    (entry) => entry.siteId === target && entry.monitorType === type,
  );
  expect(job).toBeDefined();
  expect(await finishMonitorJob(database.db, job!, result, options)).toBe(true);
  return job!;
}
const state = async (type = 'uptime') =>
  (
    await database.db
      .select()
      .from(schema.monitorJobs)
      .where(
        and(
          eq(schema.monitorJobs.siteId, siteId),
          sql`${schema.monitorJobs.monitorType} = ${type}`,
        ),
      )
  )[0]!;
const incidents = async () =>
  database.db
    .select()
    .from(schema.incidents)
    .where(
      and(
        eq(schema.incidents.siteId, siteId),
        eq(schema.incidents.monitorType, 'uptime'),
      ),
    );

beforeAll(async () => {
  const url = process.env.TEST_DATABASE_URL;
  if (!url || !decodeURIComponent(new URL(url).pathname).endsWith('_test'))
    throw new Error('Dedicated _test database required');
  database = createDatabase(url);
  await migrateDatabase(database.db);
  await migrateDatabase(database.db);
  await database.db.execute(sql`TRUNCATE users CASCADE`);
  app = await buildApp({
    db: database.db,
    env: parseEnvironment({
      NODE_ENV: 'test',
      DATABASE_URL: url,
      APP_ORIGIN: origin,
      BETTER_AUTH_SECRET: randomBytes(48).toString('base64url'),
      LOG_LEVEL: 'silent',
    }),
    sendAuthMail: async () => {},
    resolveHost: async () => ['8.8.8.8'],
  });
  owner = await signup('monitor-owner');
  outsider = await signup('monitor-outsider');
  member = await signup('monitor-member');
  unverified = await signup('monitor-unverified');
  await database.db
    .update(schema.users)
    .set({ emailVerified: true, emailVerifiedAt: new Date() })
    .where(
      sql`${schema.users.id} in (${owner.id}, ${outsider.id}, ${member.id})`,
    );
  const response = await call('POST', '/organizations', owner.cookie, {
    name: 'Monitors',
    slug: 'monitors',
  });
  organizationId = response.json().organization.id;
  await database.db.insert(schema.organizationMembers).values([
    { organizationId, userId: member.id, role: 'member' },
    { organizationId, userId: unverified.id, role: 'admin' },
  ]);
  const [second] = await database.db
    .insert(schema.organizations)
    .values({ name: 'Other', slug: 'other', ownerUserId: outsider.id })
    .returning();
  await database.db
    .insert(schema.organizationMembers)
    .values({ organizationId: second!.id, userId: outsider.id, role: 'owner' });
  const sites = await database.db
    .insert(schema.sites)
    .values([
      {
        organizationId,
        name: 'Monitor WP',
        canonicalUrl: 'https://wp.customer-domain.com',
        hostname: 'wp.customer-domain.com',
        status: 'active',
      },
      {
        organizationId: second!.id,
        name: 'Other WP',
        canonicalUrl: 'http://other.customer-domain.com',
        hostname: 'other.customer-domain.com',
        status: 'active',
      },
    ])
    .returning();
  siteId = sites[0]!.id;
  otherSiteId = sites[1]!.id;
  await database.db.insert(schema.siteCredentials).values(
    sites.map((site) => ({
      siteId: site.id,
      credentialHash: randomBytes(32).toString('hex'),
    })),
  );
});
afterAll(async () => {
  await app?.close();
  await database?.pool.end();
});

it('seeds idempotent durable jobs, creates SSL only for HTTPS and leases exclusively', async () => {
  await seedMonitorJobs(database.db);
  await seedMonitorJobs(database.db);
  expect(await database.db.select().from(schema.monitorJobs)).toHaveLength(3);
  const [left, right] = await Promise.all([
    claimMonitorJobs(database.db),
    claimMonitorJobs(database.db),
  ]);
  expect(left.length + right.length).toBe(3);
  expect(new Set([...left, ...right].map((job) => job.id)).size).toBe(3);
  for (const job of [...left, ...right])
    expect(await finishMonitorJob(database.db, job, success, options)).toBe(
      true,
    );
});
it('suspects a single failure without opening an incident and schedules bounded retry', async () => {
  await tick(failure);
  const job = await state();
  expect(job.state).toBe('suspected');
  expect(job.failures).toBe(1);
  expect(job.nextRunAt.getTime() - Date.now()).toBeGreaterThan(50000);
  expect(job.nextRunAt.getTime() - Date.now()).toBeLessThan(65000);
  expect(await incidents()).toHaveLength(0);
});
it('does not count separated failures as consecutive', async () => {
  await tick(success);
  await tick(failure);
  expect((await state()).state).toBe('suspected');
  expect(await incidents()).toHaveLength(0);
});
it('confirms an outage after two failures and deduplicates repeated failures', async () => {
  await tick(failure);
  await tick(failure);
  await tick(failure);
  expect((await state()).state).toBe('down');
  const rows = await incidents();
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ status: 'open', severity: 'critical' });
  const deliveries = await database.db
    .select()
    .from(schema.notificationDeliveries)
    .where(eq(schema.notificationDeliveries.incidentId, rows[0]!.id));
  expect(deliveries.map((delivery) => delivery.recipient).sort()).toEqual([
    'monitor-member@example.com',
    'monitor-owner@example.com',
  ]);
  expect(deliveries.every((delivery) => delivery.eventType === 'opened')).toBe(
    true,
  );
  const events = await database.db
    .select()
    .from(schema.auditLogs)
    .where(eq(schema.auditLogs.action, 'monitor.incident_opened'));
  expect(events).toHaveLength(1);
});
it('requires session and tenant membership for all monitoring reads and mutations', async () => {
  const incident = (await incidents())[0]!;
  for (const path of [
    `/sites/${siteId}/checks`,
    `/sites/${siteId}/incidents`,
    `/organizations/${organizationId}/incidents`,
  ]) {
    expect((await call('GET', path, '')).statusCode).toBe(401);
    expect((await call('GET', path, outsider.cookie)).statusCode).toBe(404);
    expect((await call('GET', path, member.cookie)).statusCode).toBe(200);
  }
  expect(
    (
      await call(
        'POST',
        `/sites/${siteId}/incidents/${incident.id}/acknowledge`,
        outsider.cookie,
        {},
      )
    ).statusCode,
  ).toBe(404);
  expect(
    (
      await call(
        'POST',
        `/sites/${siteId}/incidents/${incident.id}/acknowledge`,
        member.cookie,
        {},
      )
    ).statusCode,
  ).toBe(403);
  expect(
    (
      await call(
        'POST',
        `/sites/${siteId}/incidents/${incident.id}/acknowledge`,
        unverified.cookie,
        {},
      )
    ).statusCode,
  ).toBe(403);
  expect(
    (
      await call(
        'POST',
        `/sites/${otherSiteId}/incidents/${incident.id}/acknowledge`,
        outsider.cookie,
        {},
      )
    ).statusCode,
  ).toBe(404);
  expect(
    (
      await app.inject({
        method: 'POST',
        url: `/api/v1/sites/${siteId}/incidents/${incident.id}/acknowledge`,
        headers: { cookie: owner.cookie },
        payload: {},
      })
    ).statusCode,
  ).toBe(403);
});
it('acknowledges idempotently while preserving ongoing detection', async () => {
  const incident = (await incidents())[0]!;
  for (let i = 0; i < 2; i++)
    expect(
      (
        await call(
          'POST',
          `/sites/${siteId}/incidents/${incident.id}/acknowledge`,
          owner.cookie,
          {},
        )
      ).statusCode,
    ).toBe(200);
  await tick(failure);
  expect((await incidents())[0]!.status).toBe('acknowledged');
  expect(
    await database.db
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.action, 'monitor.incident_acknowledged')),
  ).toHaveLength(1);
});
it('requires two consecutive successes to resolve, including after a failed recovery', async () => {
  await tick(success);
  expect((await state()).state).toBe('recovering');
  expect((await incidents())[0]!.status).toBe('acknowledged');
  await tick(failure);
  expect((await state()).state).toBe('down');
  await tick(success);
  await tick(success);
  expect((await state()).state).toBe('healthy');
  expect((await incidents())[0]).toMatchObject({
    status: 'resolved',
    resolutionReason: 'recovered',
    resolvedAt: expect.any(Date),
  });
  expect(
    await database.db
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.action, 'monitor.incident_resolved')),
  ).toHaveLength(1);
  const deliveries = await database.db
    .select()
    .from(schema.notificationDeliveries)
    .where(
      eq(schema.notificationDeliveries.incidentId, (await incidents())[0]!.id),
    );
  expect(
    deliveries.filter((delivery) => delivery.eventType === 'recovered'),
  ).toHaveLength(2);
});

it('retries transient delivery failures and records only provider handoff state', async () => {
  const incident = (await incidents())[0]!;
  await database.db
    .update(schema.notificationDeliveries)
    .set({ status: 'sent', sentAt: new Date() })
    .where(eq(schema.notificationDeliveries.status, 'queued'));
  const [delivery] = await database.db
    .insert(schema.notificationDeliveries)
    .values({
      incidentId: incident.id,
      eventKey: `${incident.id}:test-retry:${randomBytes(8).toString('hex')}`,
      eventType: 'opened',
      recipient: 'monitor-owner@example.com',
      siteName: 'Monitor WP',
      siteUrl: 'https://wp.customer-domain.com',
      monitorType: 'uptime',
      severity: 'critical',
    })
    .returning();
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(new Response(null, { status: 503 }))
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'provider-message-fixture' }), {
        status: 200,
      }),
    );
  vi.stubGlobal('fetch', fetchMock);
  try {
    await deliverNotificationBatch(database.db, {
      AUTH_MAIL_TRANSPORT: 'resend',
      AUTH_MAIL_FROM: 'alerts@example.com',
      RESEND_API_KEY: 'test-provider-key-not-used',
      APP_ORIGIN: origin,
    });
    let [state] = await database.db
      .select()
      .from(schema.notificationDeliveries)
      .where(eq(schema.notificationDeliveries.id, delivery!.id));
    expect(state).toMatchObject({
      status: 'queued',
      attempts: 1,
      lastErrorCode: 'PROVIDER_REJECTED',
    });
    await database.db
      .update(schema.notificationDeliveries)
      .set({ nextAttemptAt: new Date(0) })
      .where(eq(schema.notificationDeliveries.id, delivery!.id));
    await deliverNotificationBatch(database.db, {
      AUTH_MAIL_TRANSPORT: 'resend',
      AUTH_MAIL_FROM: 'alerts@example.com',
      RESEND_API_KEY: 'test-provider-key-not-used',
      APP_ORIGIN: origin,
    });
    [state] = await database.db
      .select()
      .from(schema.notificationDeliveries)
      .where(eq(schema.notificationDeliveries.id, delivery!.id));
    expect(state).toMatchObject({
      status: 'sent',
      attempts: 2,
      providerMessageId: 'provider-message-fixture',
      lastErrorCode: null,
      sentAt: expect.any(Date),
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({
      headers: expect.objectContaining({
        'Idempotency-Key': delivery!.eventKey,
      }),
    });
  } finally {
    vi.unstubAllGlobals();
  }
});
it('opens a new incident for a later outage and DB prevents duplicate active fingerprints', async () => {
  await tick(failure);
  await tick(failure);
  const rows = await incidents();
  expect(rows).toHaveLength(2);
  const active = rows.find((row) => row.status === 'open')!;
  await expect(
    database.db.insert(schema.incidents).values({
      siteId,
      monitorType: 'uptime',
      severity: 'critical',
      fingerprint: active.fingerprint,
    }),
  ).rejects.toThrow();
});
it('handles SSL warnings independently, escalation, expiry details and recovery', async () => {
  const warning: ProbeResult = {
    result: 'warning',
    sslExpiresAt: new Date(Date.now() + 7 * 86400000),
    errorCode: 'TLS_EXPIRING_7D',
  };
  await tick(warning, 'ssl');
  await tick(warning, 'ssl');
  expect((await state('ssl')).state).toBe('warning');
  expect((await state()).state).toBe('down');
  await tick({ result: 'error', errorCode: 'TLS_EXPIRED' }, 'ssl');
  const rows = await database.db
    .select()
    .from(schema.incidents)
    .where(
      and(
        eq(schema.incidents.siteId, siteId),
        eq(schema.incidents.monitorType, 'ssl'),
      ),
    );
  expect(rows).toHaveLength(1);
  expect(rows[0]!.severity).toBe('critical');
  await tick(
    { result: 'up', sslExpiresAt: new Date(Date.now() + 90 * 86400000) },
    'ssl',
  );
  await tick({ result: 'up' }, 'ssl');
  expect((await state('ssl')).state).toBe('healthy');
});
it('rejects duplicate and expired leases, reclaims abandoned work and fences the old worker', async () => {
  const old = await tick(failure);
  expect(await finishMonitorJob(database.db, old, failure, options)).toBe(
    false,
  );
  await database.db
    .update(schema.monitorJobs)
    .set({ nextRunAt: new Date(0) })
    .where(eq(schema.monitorJobs.id, old.id));
  const abandoned = (await claimMonitorJobs(database.db)).find(
    (job) => job.id === old.id,
  )!;
  await database.db
    .update(schema.monitorJobs)
    .set({ leaseExpiresAt: new Date(0) })
    .where(eq(schema.monitorJobs.id, old.id));
  expect(await finishMonitorJob(database.db, abandoned, success, options)).toBe(
    false,
  );
  const reclaimed = (await claimMonitorJobs(database.db)).find(
    (job) => job.id === old.id,
  )!;
  expect(reclaimed.leaseToken).not.toBe(abandoned.leaseToken);
  expect(await finishMonitorJob(database.db, abandoned, success, options)).toBe(
    false,
  );
  expect(await finishMonitorJob(database.db, reclaimed, failure, options)).toBe(
    true,
  );
});
it('bounds read results, hides internal leases and scopes organization incidents', async () => {
  await database.db.insert(schema.monitorChecks).values(
    Array.from({ length: 110 }, () => ({
      siteId,
      monitorType: 'uptime' as const,
      result: 'up' as const,
    })),
  );
  const response = await call('GET', `/sites/${siteId}/checks`);
  expect(response.json().checks).toHaveLength(100);
  const detail = (await call('GET', `/sites/${siteId}`)).json();
  expect(detail.monitoring).toHaveLength(2);
  expect(JSON.stringify(detail)).not.toMatch(
    /leaseToken|leaseExpiresAt|credentialHash/,
  );
  const org = (
    await call('GET', `/organizations/${organizationId}/incidents`)
  ).json();
  expect(org.incidents.length).toBeGreaterThan(0);
  expect(
    org.incidents.every((row: { siteId: string }) => row.siteId === siteId),
  ).toBe(true);
});
it('stops disconnected sites, closes incidents without claiming recovery and rejects in-flight results', async () => {
  await database.db
    .update(schema.monitorJobs)
    .set({ nextRunAt: new Date(0) })
    .where(eq(schema.monitorJobs.siteId, siteId));
  const inflight = (await claimMonitorJobs(database.db)).filter(
    (job) => job.siteId === siteId,
  );
  expect(
    (await call('POST', `/sites/${siteId}/disconnect`, owner.cookie, {}))
      .statusCode,
  ).toBe(200);
  for (const job of inflight)
    expect(await finishMonitorJob(database.db, job, success, options)).toBe(
      false,
    );
  await seedMonitorJobs(database.db);
  expect(
    await database.db
      .select()
      .from(schema.monitorJobs)
      .where(eq(schema.monitorJobs.siteId, siteId)),
  ).toHaveLength(0);
  expect(
    (await incidents()).some(
      (row) => row.resolutionReason === 'connection_reset',
    ),
  ).toBe(true);
  expect(
    (await claimMonitorJobs(database.db)).some((job) => job.siteId === siteId),
  ).toBe(false);
});
it('re-pairing starts clean jobs and invalidates work from the old connection', async () => {
  const challenge = (
    await call('POST', `/sites/${siteId}/pairing-challenges`, owner.cookie, {})
  ).json().challenge;
  const response = await call('POST', '/connector/pair', '', {
    challenge,
    canonicalUrl: 'https://wp.customer-domain.com',
  });
  expect(response.statusCode, response.body).toBe(200);
  await seedMonitorJobs(database.db);
  const jobs = await database.db
    .select()
    .from(schema.monitorJobs)
    .where(eq(schema.monitorJobs.siteId, siteId));
  expect(jobs).toHaveLength(2);
  expect(
    jobs.every((job) => job.state === 'pending' && job.failures === 0),
  ).toBe(true);
  await database.db
    .update(schema.monitorJobs)
    .set({ nextRunAt: new Date(0) })
    .where(eq(schema.monitorJobs.siteId, siteId));
  const inflight = (await claimMonitorJobs(database.db)).filter(
    (job) => job.siteId === siteId,
  );
  const newChallenge = (
    await call('POST', `/sites/${siteId}/pairing-challenges`, owner.cookie, {})
  ).json().challenge;
  expect(
    (
      await call('POST', '/connector/pair', '', {
        challenge: newChallenge,
        canonicalUrl: 'https://wp.customer-domain.com',
      })
    ).statusCode,
  ).toBe(200);
  for (const job of inflight)
    expect(await finishMonitorJob(database.db, job, failure, options)).toBe(
      false,
    );
});
it('executes scheduled jobs and performs bounded retention without deleting open incidents', async () => {
  await database.db.insert(schema.monitorChecks).values({
    siteId,
    monitorType: 'uptime',
    result: 'up',
    checkedAt: new Date(0),
  });
  await database.db.insert(schema.incidents).values([
    {
      siteId,
      monitorType: 'ssl',
      severity: 'warning',
      fingerprint: randomUUID(),
      status: 'resolved',
      resolvedAt: new Date(0),
    },
    {
      siteId,
      monitorType: 'ssl',
      severity: 'critical',
      fingerprint: randomUUID(),
      startedAt: new Date(0),
    },
  ]);
  expect(
    await runMonitoring(database.db, options, async () => success),
  ).toBeGreaterThan(0);
  expect(
    await database.db
      .select()
      .from(schema.monitorChecks)
      .where(eq(schema.monitorChecks.checkedAt, new Date(0))),
  ).toHaveLength(0);
  expect(
    await database.db
      .select()
      .from(schema.incidents)
      .where(eq(schema.incidents.resolvedAt, new Date(0))),
  ).toHaveLength(0);
  expect(
    await database.db
      .select()
      .from(schema.incidents)
      .where(
        and(
          eq(schema.incidents.status, 'open'),
          eq(schema.incidents.startedAt, new Date(0)),
        ),
      ),
  ).toHaveLength(1);
});
it('soft deletion hides monitoring resources and removes runnable jobs', async () => {
  expect((await call('DELETE', `/sites/${siteId}`)).statusCode).toBe(200);
  for (const path of ['checks', 'incidents'])
    expect((await call('GET', `/sites/${siteId}/${path}`)).statusCode).toBe(
      404,
    );
  await seedMonitorJobs(database.db);
  expect(
    await database.db
      .select()
      .from(schema.monitorJobs)
      .where(eq(schema.monitorJobs.siteId, siteId)),
  ).toHaveLength(0);
  expect(
    (await call('GET', `/organizations/${organizationId}/incidents`)).json()
      .incidents,
  ).toHaveLength(0);
});
