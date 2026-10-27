import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { createDatabase, eq, schema, sql } from '@sitepulse/database';
import { migrateDatabase } from '@sitepulse/database/migrate';
import { parseEnvironment } from '@sitepulse/config';
import { buildApp } from '../src/app';

const origin = 'http://localhost:3000';
let app: Awaited<ReturnType<typeof buildApp>>;
let database: ReturnType<typeof createDatabase>;
type Identity = { id: string; cookie: string };
let platform: Identity;
let owner: Identity;
let admin: Identity;
let unverified: Identity;
let organizationId: string;
const change = {
  planCode: 'pro',
  siteLimitOverride: null,
  reason: 'Approved pilot allocation',
};
const path = () => `/admin/workspaces/${organizationId}/entitlements`;
function call(
  method: 'GET' | 'POST' | 'PATCH',
  url: string,
  payload?: object,
  identity = platform,
) {
  return app.inject({
    method,
    url: `/api/v1${url}`,
    headers: { origin, cookie: identity.cookie },
    ...(payload ? { payload } : {}),
  });
}
const preview = async (
  payload: {
    planCode: string;
    siteLimitOverride: number | null;
    reason: string;
  } = change,
) => {
  const response = await call('POST', `${path()}/preview`, payload);
  expect(response.statusCode, response.body).toBe(200);
  return response.json();
};
const logs = () =>
  database.db
    .select()
    .from(schema.auditLogs)
    .where(eq(schema.auditLogs.organizationId, organizationId));

beforeAll(async () => {
  const url = process.env.TEST_DATABASE_URL;
  if (!url || !decodeURIComponent(new URL(url).pathname).endsWith('_test'))
    throw new Error('Dedicated _test database required');
  database = createDatabase(url);
  await migrateDatabase(database.db);
  await database.db.execute(sql`TRUNCATE users CASCADE`);
  const env = parseEnvironment({
    DATABASE_URL: url,
    NODE_ENV: 'test',
    APP_ORIGIN: origin,
    BETTER_AUTH_SECRET: randomBytes(48).toString('base64url'),
    LOG_LEVEL: 'silent',
  });
  app = await buildApp({ db: database.db, env, sendAuthMail: async () => {} });
  async function register(name: string, verified = true) {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      headers: { origin },
      payload: {
        name,
        email: `${name}@example.com`,
        password: 'platform test passphrase',
      },
    });
    expect(response.statusCode, response.body).toBe(201);
    const identity = {
      id: response.json().user.id as string,
      cookie: response.cookies.map((c) => `${c.name}=${c.value}`).join('; '),
    };
    if (verified)
      await database.db
        .update(schema.users)
        .set({ emailVerified: true, emailVerifiedAt: new Date() })
        .where(eq(schema.users.id, identity.id));
    return identity;
  }
  platform = await register('platform');
  owner = await register('owner');
  admin = await register('admin');
  unverified = await register('unverified', false);
  await app.close();
  app = await buildApp({
    db: database.db,
    env: { ...env, PLATFORM_ADMIN_USER_IDS: [platform.id, unverified.id] },
    sendAuthMail: async () => {},
  });
});
beforeEach(async () => {
  const response = await call(
    'POST',
    '/organizations',
    { name: 'Managed workspace', slug: randomUUID() },
    owner,
  );
  expect(response.statusCode, response.body).toBe(201);
  organizationId = response.json().organization.id;
  await database.db
    .insert(schema.organizationMembers)
    .values({ organizationId, userId: admin.id, role: 'admin' });
});
afterAll(async () => {
  await app?.close();
  await database?.pool.end();
});

it('exposes the platform flag only for verified allowlisted identities', async () => {
  for (const identity of [platform, owner, admin, unverified]) {
    const response = await call('GET', '/auth/session', undefined, identity);
    expect(response.json().user.isPlatformAdmin).toBe(identity === platform);
  }
});
it('rejects missing sessions, organization owners/admins and unverified platform users on every admin route', async () => {
  for (const identity of [owner, admin, unverified, { id: '', cookie: '' }]) {
    for (const [method, url, body] of [
      ['GET', '/admin/workspaces', undefined],
      ['POST', `${path()}/preview`, change],
      ['PATCH', path(), change],
    ] as const) {
      const response = await call(method, url, body, identity);
      expect(response.statusCode, response.body).toBe(
        identity.cookie ? 403 : 401,
      );
    }
  }
});
it('does not trust forged identity headers or tenant plan fields', async () => {
  const forged = await app.inject({
    method: 'GET',
    url: '/api/v1/admin/workspaces',
    headers: {
      cookie: owner.cookie,
      'x-user-id': platform.id,
      'x-platform-admin': 'true',
    },
  });
  expect(forged.statusCode).toBe(403);
  expect(
    (
      await call(
        'PATCH',
        `/organizations/${organizationId}`,
        { name: 'Forged', planCode: 'pro' },
        owner,
      )
    ).statusCode,
  ).toBe(400);
});
it('searches literal name/slug/UUID without granting tenant access', async () => {
  const result = await call('GET', `/admin/workspaces?q=${organizationId}`);
  expect(result.json().workspaces).toHaveLength(1);
  expect(result.json().workspaces[0]).toMatchObject({
    id: organizationId,
    usage: { siteLimit: 2, sitesUsed: 0 },
  });
  expect(
    (await call('GET', `/organizations/${organizationId}/sites`)).statusCode,
  ).toBe(404);
  expect(
    (await call('GET', '/admin/workspaces?q=%25')).json().workspaces,
  ).toEqual([]);
  expect(
    (await call('GET', '/admin/workspaces?q=%27%20OR%201%3D1--')).json()
      .workspaces,
  ).toEqual([]);
  for (const query of [
    'page=0',
    'page=-1',
    'page=100000',
    'q=' + 'a'.repeat(101),
    'role=admin',
  ])
    expect((await call('GET', `/admin/workspaces?${query}`)).statusCode).toBe(
      400,
    );
});
it('paginates a bounded workspace directory', async () => {
  await database.db.insert(schema.organizations).values(
    Array.from({ length: 26 }, (_, index) => ({
      name: `Pagination ${String(index).padStart(2, '0')}`,
      slug: randomUUID(),
      ownerUserId: owner.id,
    })),
  );
  const first = (await call('GET', '/admin/workspaces?q=Pagination')).json();
  const second = (
    await call('GET', '/admin/workspaces?q=Pagination&page=2')
  ).json();
  expect(first.workspaces).toHaveLength(25);
  expect(first.hasMore).toBe(true);
  expect(second.workspaces).toHaveLength(1);
  expect(second.hasMore).toBe(false);
  expect(
    first.workspaces.some(
      (w: { id: string }) => w.id === second.workspaces[0].id,
    ),
  ).toBe(false);
});
it('previews without writes and atomically saves the authenticated actor and before/after audit', async () => {
  const count = (await logs()).length;
  const impact = await preview();
  expect(impact.before.siteLimit).toBe(2);
  expect(impact.after.siteLimit).toBe(10);
  expect((await logs()).length).toBe(count);
  const [row] = await database.db
    .select()
    .from(schema.organizations)
    .where(eq(schema.organizations.id, organizationId));
  expect(row!.planCode).toBe('free');
  const response = await call('PATCH', path(), {
    ...change,
    expected: impact.expected,
  });
  expect(response.statusCode, response.body).toBe(200);
  const audit = (await logs()).find(
    (event) => event.action === 'organization.entitlements.updated',
  );
  expect(audit).toMatchObject({
    actorUserId: platform.id,
    requestId: response.headers['x-request-id'],
    metadata: {
      reason: change.reason,
      previousPlan: 'free',
      plan: 'pro',
      previousLimit: '2',
      siteLimit: '10',
      operator: 'platform-admin',
    },
  });
});
it('supports zero, custom and reset allowances and preserves existing sites on downgrade', async () => {
  await database.db.insert(schema.sites).values(
    Array.from({ length: 3 }, () => ({
      organizationId,
      name: 'Preserved site',
      canonicalUrl: `https://${randomUUID()}.example.com`,
      hostname: 'example.com',
    })),
  );
  for (const siteLimitOverride of [0, 15, null]) {
    const payload = { ...change, planCode: 'free', siteLimitOverride };
    const impact = await preview(payload);
    expect(impact.after).toMatchObject({
      sitesUsed: 3,
      siteLimit: siteLimitOverride ?? 2,
      overLimit: siteLimitOverride !== 15,
    });
    const saved = await call('PATCH', path(), {
      ...payload,
      expected: impact.expected,
    });
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.json().usage).toEqual(impact.after);
  }
  const sites = await database.db
    .select()
    .from(schema.sites)
    .where(eq(schema.sites.organizationId, organizationId));
  expect(sites).toHaveLength(3);
  expect(sites.every((s) => s.deletedAt === null)).toBe(true);
});
it('requires valid input, reason, expected snapshot and trusted Origin', async () => {
  const impact = await preview();
  for (const body of [
    { ...change, reason: ' ' },
    { ...change, siteLimitOverride: -1 },
    { ...change, siteLimitOverride: 1001 },
    { ...change, siteLimitOverride: 1.5 },
    { ...change, planCode: 'enterprise' },
    { ...change, operator: 'spoof' },
    { ...change, actorUserId: owner.id },
  ])
    expect((await call('POST', `${path()}/preview`, body)).statusCode).toBe(
      400,
    );
  expect((await call('PATCH', path(), change)).statusCode).toBe(400);
  expect(
    (
      await call('PATCH', path(), {
        ...change,
        expected: impact.expected,
        actorUserId: owner.id,
      })
    ).statusCode,
  ).toBe(400);
  expect(
    (
      await app.inject({
        method: 'PATCH',
        url: `/api/v1${path()}`,
        headers: { origin: 'https://evil.example', cookie: platform.cookie },
        payload: { ...change, expected: impact.expected },
      })
    ).statusCode,
  ).toBe(403);
});
it('rejects stale usage previews without changing entitlements or auditing a save', async () => {
  const impact = await preview();
  await database.db.insert(schema.sites).values({
    organizationId,
    name: 'Concurrent addition',
    canonicalUrl: 'https://new.example.com',
    hostname: 'new.example.com',
  });
  const response = await call('PATCH', path(), {
    ...change,
    expected: impact.expected,
  });
  expect(response.statusCode).toBe(409);
  expect(response.json().error.code).toBe('PREVIEW_EXPIRED');
  expect(
    (await logs()).filter(
      (event) => event.action === 'organization.entitlements.updated',
    ),
  ).toHaveLength(0);
});
it('serializes simultaneous saves from the same preview', async () => {
  const impact = await preview();
  const responses = await Promise.all(
    [10, 15].map((siteLimitOverride) =>
      call('PATCH', path(), {
        ...change,
        siteLimitOverride,
        expected: impact.expected,
      }),
    ),
  );
  expect(responses.map((r) => r.statusCode).sort()).toEqual([200, 409]);
  expect(
    (await logs()).filter(
      (event) => event.action === 'organization.entitlements.updated',
    ),
  ).toHaveLength(1);
});
it('returns 404 for missing workspaces and rejects revoked sessions', async () => {
  expect(
    (
      await call(
        'POST',
        `/admin/workspaces/${randomUUID()}/entitlements/preview`,
        change,
      )
    ).statusCode,
  ).toBe(404);
  await call('POST', '/auth/logout', {}, platform);
  expect((await call('GET', '/admin/workspaces')).statusCode).toBe(401);
});
