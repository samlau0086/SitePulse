import { randomBytes, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { and, createDatabase, eq, schema, sql } from '@sitepulse/database';
import { migrateDatabase } from '@sitepulse/database/migrate';
import { parseEnvironment, planSiteLimits } from '@sitepulse/config';
import { buildApp } from '../src/app';
import { changeEntitlements } from '../src/entitlements';
import { seedMonitorJobs } from '../../worker/src/monitoring';

const origin = 'http://localhost:3000';
let app: Awaited<ReturnType<typeof buildApp>>;
let database: ReturnType<typeof createDatabase>;
let owner: { id: string; cookie: string };
let member: { id: string; cookie: string };
let outsider: { id: string; cookie: string };
let organizationId: string;

function call(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  payload?: object,
  cookie = owner.cookie,
) {
  return app.inject({
    method,
    url: `/api/v1${path}`,
    headers: { origin, cookie },
    ...(payload ? { payload } : {}),
  });
}
const create = () =>
  call('POST', `/organizations/${organizationId}/sites`, {
    name: 'Quota test',
    canonicalUrl: `https://${randomUUID()}.example.com`,
  });
const usage = async () =>
  (await call('GET', `/organizations/${organizationId}/usage`)).json().usage;
const change = (planCode = 'free', siteLimitOverride: number | null = null) =>
  changeEntitlements(database.db, {
    organizationId,
    planCode,
    siteLimitOverride,
    operator: 'test-operator',
    reason: 'Test entitlement allocation',
  });
async function fixtureSites(count: number, deleted = false) {
  return database.db
    .insert(schema.sites)
    .values(
      Array.from({ length: count }, () => ({
        organizationId,
        name: 'Fixture',
        canonicalUrl: `https://${randomUUID()}.example.com`,
        hostname: 'example.com',
        ...(deleted
          ? { deletedAt: new Date(), status: 'disconnected' as const }
          : {}),
      })),
    )
    .returning();
}

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
  async function register(label: string) {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      headers: { origin },
      payload: {
        email: `${label}@example.com`,
        name: label,
        password: 'entitlements test passphrase',
      },
    });
    expect(response.statusCode, response.body).toBe(201);
    return {
      id: response.json().user.id as string,
      cookie: response.cookies.map((c) => `${c.name}=${c.value}`).join('; '),
    };
  }
  owner = await register('quota-owner');
  member = await register('quota-member');
  outsider = await register('quota-outsider');
  await database.db
    .update(schema.users)
    .set({ emailVerified: true, emailVerifiedAt: new Date() });
});
beforeEach(async () => {
  const response = await call('POST', '/organizations', {
    name: 'Quota workspace',
    slug: randomUUID(),
  });
  expect(response.statusCode, response.body).toBe(201);
  organizationId = response.json().organization.id;
  await database.db
    .insert(schema.organizationMembers)
    .values({ organizationId, userId: member.id, role: 'member' });
});
afterAll(async () => {
  await app?.close();
  await database?.pool.end();
});

it.each(Object.entries(planSiteLimits))(
  'enforces %s plan boundary (%i sites)',
  async (plan, limit) => {
    await change(plan);
    await fixtureSites(limit - 1);
    expect((await create()).statusCode).toBe(201);
    const denied = await create();
    expect(denied.statusCode).toBe(409);
    expect(denied.json().error.code).toBe('SITE_LIMIT_REACHED');
    expect(await usage()).toMatchObject({
      planCode: plan,
      sitesUsed: limit,
      siteLimit: limit,
      sitesRemaining: 0,
      canAddSite: false,
      overLimit: false,
    });
  },
);
it('counts pending/disconnected sites and frees a slot only on deletion', async () => {
  const first = (await create()).json().site;
  const second = (await create()).json().site;
  expect(
    (await call('POST', `/sites/${first.id}/disconnect`, {})).statusCode,
  ).toBe(200);
  expect((await create()).statusCode).toBe(409);
  expect((await call('DELETE', `/sites/${second.id}`, {})).statusCode).toBe(
    200,
  );
  expect(await usage()).toMatchObject({ sitesUsed: 1, sitesRemaining: 1 });
  expect((await create()).statusCode).toBe(201);
});
it('permits only one concurrent creation for the last slot', async () => {
  await fixtureSites(1);
  const responses = await Promise.all(Array.from({ length: 8 }, create));
  expect(responses.filter((r) => r.statusCode === 201)).toHaveLength(1);
  expect(responses.filter((r) => r.statusCode === 409)).toHaveLength(7);
  expect((await usage()).sitesUsed).toBe(2);
});
it('serializes restoring and creating against the same quota', async () => {
  await fixtureSites(1);
  const [deleted] = await fixtureSites(1, true);
  const responses = await Promise.all([
    create(),
    call('POST', `/sites/${deleted!.id}/restore`, {}),
  ]);
  expect(responses.map((r) => r.statusCode).sort()).toEqual(
    responses[0]!.statusCode === 201 ? [201, 409] : [200, 409],
  );
  expect((await usage()).sitesUsed).toBe(2);
});
it('restores without reviving deleted credentials and requires fresh pairing', async () => {
  const site = (await create()).json().site;
  const challenge = (
    await call('POST', `/sites/${site.id}/pairing-challenges`, {})
  ).json().challenge;
  const paired = await call('POST', '/connector/pair', {
    challenge,
    canonicalUrl: site.canonicalUrl,
  });
  expect(paired.statusCode).toBe(200);
  expect((await call('DELETE', `/sites/${site.id}`, {})).statusCode).toBe(200);
  const restored = await call('POST', `/sites/${site.id}/restore`, {});
  expect(restored.statusCode, restored.body).toBe(200);
  expect(restored.json().site).toMatchObject({
    status: 'disconnected',
    deletedAt: null,
  });
  const heartbeat = await app.inject({
    method: 'POST',
    url: '/api/v1/connector/heartbeat',
    headers: { origin, authorization: `Bearer ${paired.json().credential}` },
    payload: { siteId: site.id, sequence: 1, connectorVersion: '0.1.0' },
  });
  expect(heartbeat.statusCode).toBe(401);
  expect(
    (await call('POST', `/sites/${site.id}/pairing-challenges`, {})).statusCode,
  ).toBe(200);
});
it('enforces quota on restoration and rejects duplicate active site URLs', async () => {
  const site = (await create()).json().site;
  await call('DELETE', `/sites/${site.id}`, {});
  await call('POST', `/organizations/${organizationId}/sites`, {
    name: 'Replacement',
    canonicalUrl: site.canonicalUrl,
  });
  const conflict = await call('POST', `/sites/${site.id}/restore`, {});
  expect(conflict.statusCode).toBe(409);
  expect(conflict.json().error.code).toBe('CONFLICT');
  await create();
  expect(
    (await call('POST', `/sites/${site.id}/restore`, {})).json().error.code,
  ).toBe('SITE_LIMIT_REACHED');
});
it('keeps existing sites, credentials and jobs on downgrade and accepts heartbeats over quota', async () => {
  await change('pro');
  await fixtureSites(2);
  const site = (await create()).json().site;
  const challenge = (
    await call('POST', `/sites/${site.id}/pairing-challenges`, {})
  ).json().challenge;
  const paired = await call('POST', '/connector/pair', {
    challenge,
    canonicalUrl: site.canonicalUrl,
  });
  expect(paired.statusCode).toBe(200);
  const beat = (sequence: number) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/connector/heartbeat',
      headers: { origin, authorization: `Bearer ${paired.json().credential}` },
      payload: { siteId: site.id, sequence, connectorVersion: '0.1.0' },
    });
  expect((await beat(1)).statusCode).toBe(200);
  await seedMonitorJobs(database.db);
  const jobsBefore = await database.db
    .select()
    .from(schema.monitorJobs)
    .where(eq(schema.monitorJobs.siteId, site.id));
  expect(jobsBefore.length).toBeGreaterThan(0);
  await change('free');
  expect(await usage()).toMatchObject({
    sitesUsed: 3,
    siteLimit: 2,
    overLimit: true,
  });
  expect((await create()).statusCode).toBe(409);
  expect((await beat(2)).statusCode).toBe(200);
  expect((await call('GET', `/sites/${site.id}`)).statusCode).toBe(200);
  expect(
    await database.db
      .select()
      .from(schema.monitorJobs)
      .where(eq(schema.monitorJobs.siteId, site.id)),
  ).toEqual(jobsBefore);
  expect(
    (await call('POST', `/sites/${site.id}/pairing-challenges`, {})).statusCode,
  ).toBe(200);
});
it('supports zero/custom overrides and explicitly resets them to plan defaults', async () => {
  await change('agency_plus', 0);
  expect(await usage()).toMatchObject({ siteLimit: 0, siteLimitOverride: 0 });
  expect((await create()).statusCode).toBe(409);
  await change('free', 3);
  expect((await create()).statusCode).toBe(201);
  expect(await usage()).toMatchObject({ siteLimit: 3, sitesRemaining: 2 });
  await change('pro');
  expect(await usage()).toMatchObject({
    siteLimit: 10,
    siteLimitOverride: null,
  });
});
it('serializes concurrent entitlement downgrade and creation', async () => {
  await change('free', 1);
  const [created] = await Promise.all([create(), change('free', 0)]);
  expect([201, 409]).toContain(created.statusCode);
  expect(await usage()).toMatchObject({
    siteLimit: 0,
    sitesUsed: created.statusCode === 201 ? 1 : 0,
  });
  expect((await create()).statusCode).toBe(409);
});
it('hides usage and restoration from outsiders and rejects member writes and forged plans', async () => {
  const [site] = await fixtureSites(1, true);
  expect(
    (await call('GET', `/organizations/${organizationId}/usage`, undefined, ''))
      .statusCode,
  ).toBe(401);
  expect(
    (
      await call(
        'GET',
        `/organizations/${organizationId}/usage`,
        undefined,
        outsider.cookie,
      )
    ).statusCode,
  ).toBe(404);
  expect(
    (await call('POST', `/sites/${site!.id}/restore`, {}, outsider.cookie))
      .statusCode,
  ).toBe(404);
  expect(
    (
      await call(
        'GET',
        `/organizations/${organizationId}/usage`,
        undefined,
        member.cookie,
      )
    ).statusCode,
  ).toBe(200);
  expect(
    (await call('POST', `/sites/${site!.id}/restore`, {}, member.cookie))
      .statusCode,
  ).toBe(403);
  expect(
    (
      await call(
        'POST',
        `/organizations/${organizationId}/sites`,
        { name: 'No', canonicalUrl: 'https://example.com' },
        member.cookie,
      )
    ).statusCode,
  ).toBe(403);
  expect(
    (
      await call('PATCH', `/organizations/${organizationId}`, {
        name: 'Forged',
        planCode: 'agency_plus',
        siteLimitOverride: 1000,
      })
    ).statusCode,
  ).toBe(400);
  expect(
    (
      await call('POST', `/organizations/${organizationId}/sites`, {
        name: 'Forged',
        canonicalUrl: 'https://example.com',
        planCode: 'pro',
      })
    ).statusCode,
  ).toBe(400);
  const untrusted = await app.inject({
    method: 'POST',
    url: `/api/v1/sites/${site!.id}/restore`,
    headers: { cookie: owner.cookie },
    payload: {},
  });
  expect(untrusted.statusCode).toBe(403);
  expect(await usage()).toMatchObject({
    planCode: 'free',
    siteLimit: 2,
    sitesUsed: 0,
  });
});
it('records validated operator identity, reason and before/after values atomically', async () => {
  await change('pro', 15);
  const logs = await database.db
    .select()
    .from(schema.auditLogs)
    .where(
      and(
        eq(schema.auditLogs.organizationId, organizationId),
        eq(schema.auditLogs.action, 'organization.entitlements.updated'),
      ),
    );
  expect(logs).toHaveLength(1);
  expect(logs[0]!.actorUserId).toBeNull();
  expect(logs[0]!.metadata).toMatchObject({
    operator: 'test-operator',
    reason: 'Test entitlement allocation',
    previousPlan: 'free',
    plan: 'pro',
    previousOverride: 'null',
    siteLimitOverride: '15',
    previousLimit: '2',
    siteLimit: '15',
  });
  await expect(change('not-a-plan', 10)).rejects.toThrow();
  await expect(change('free', -1)).rejects.toThrow();
  expect(await usage()).toMatchObject({ planCode: 'pro', siteLimit: 15 });
  expect(
    await database.db
      .select()
      .from(schema.auditLogs)
      .where(
        and(
          eq(schema.auditLogs.organizationId, organizationId),
          eq(schema.auditLogs.action, 'organization.entitlements.updated'),
        ),
      ),
  ).toHaveLength(1);
});
it('runs the operator CLI against the dedicated test database', async () => {
  const result = await promisify(execFile)(
    process.execPath,
    [
      '--import',
      'tsx',
      'apps/api/src/entitlements-cli.ts',
      '--organization',
      organizationId,
      '--plan',
      'pro',
      '--site-limit',
      'default',
      '--operator',
      'cli-test',
      '--reason',
      'Disposable database acceptance',
    ],
    { env: { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL } },
  );
  expect(JSON.parse(result.stdout).usage).toMatchObject({
    planCode: 'pro',
    siteLimit: 10,
  });
  expect(result.stdout).not.toContain(process.env.TEST_DATABASE_URL);
});
