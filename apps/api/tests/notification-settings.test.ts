import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createDatabase, eq, schema, sql } from '@sitepulse/database';
import { migrateDatabase } from '@sitepulse/database/migrate';
import { parseEnvironment } from '@sitepulse/config';
import { buildApp } from '../src/app';
import { hashCredential } from '../src/sites';
import { expireHeartbeats } from '../../worker/src/heartbeat';
import type { AuthMail } from '../src/auth-mail';
import {
  deliverNotificationBatch,
  recipientStillEnabled,
} from '../../worker/src/notifications';
import {
  claimMonitorJobs,
  finishMonitorJob,
  seedMonitorJobs,
} from '../../worker/src/monitoring';

const origin = 'http://localhost:3000';
let database: ReturnType<typeof createDatabase>;
let app: Awaited<ReturnType<typeof buildApp>>;
type Identity = { id: string; cookie: string };
let owner: Identity,
  member: Identity,
  outsider: Identity,
  admin: Identity,
  unverified: Identity;
let organizationId: string;
const mails: AuthMail[] = [];
const mailer = vi.fn(async (mail: AuthMail) => {
  mails.push(mail);
});
const base = () => `/organizations/${organizationId}`;
function call(
  method: 'POST' | 'GET' | 'PATCH' | 'DELETE',
  path: string,
  payload?: object,
  user = owner,
) {
  return app.inject({
    method,
    url: `/api/v1${path}`,
    headers: { origin, cookie: user.cookie },
    ...(payload ? { payload } : {}),
  });
}
async function configuration() {
  const response = await call('GET', `${base()}/notification-endpoints`);
  expect(response.statusCode, response.body).toBe(200);
  return response.json();
}
async function add(destination = 'client@example.com') {
  const response = await call('POST', `${base()}/notification-endpoints`, {
    destination,
  });
  expect(response.statusCode, response.body).toBe(201);
  return (await configuration()).endpoints.find(
    (row: { destination: string }) =>
      row.destination === destination.toLowerCase(),
  ) as { id: string; destination: string };
}
function proof() {
  return Object.fromEntries(
    new URLSearchParams(new URL(mails.at(-1)!.url).hash.slice(1)),
  );
}
async function verify() {
  const response = await call(
    'POST',
    '/notification-endpoints/verify',
    proof(),
    { id: '', cookie: '' },
  );
  expect(response.statusCode, response.body).toBe(200);
}
async function expireCooldown(endpointId: string) {
  await database.db
    .update(schema.notificationEndpoints)
    .set({ lastMailAt: new Date(0) })
    .where(eq(schema.notificationEndpoints.id, endpointId));
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
    sendAuthMail: mailer,
  });
  async function register(name: string, verified = true) {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      headers: { origin },
      payload: {
        name,
        email: `${name}@example.com`,
        password: 'notification test passphrase',
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
  owner = await register('notification-owner');
  member = await register('notification-member');
  outsider = await register('notification-outsider');
  admin = await register('notification-admin');
  unverified = await register('notification-unverified', false);
});
beforeEach(async () => {
  mailer.mockClear();
  mails.length = 0;
  const response = await call('POST', '/organizations', {
    name: 'Notification workspace',
    slug: randomUUID(),
  });
  expect(response.statusCode, response.body).toBe(201);
  organizationId = response.json().organization.id;
  await database.db.insert(schema.organizationMembers).values([
    { organizationId, userId: member.id, role: 'member' },
    { organizationId, userId: admin.id, role: 'admin' },
    { organizationId, userId: unverified.id, role: 'admin' },
  ]);
});
afterAll(async () => {
  await app?.close();
  await database?.pool.end();
});

it('checks membership, verified management roles, session and Origin independently', async () => {
  for (const identity of [
    member,
    unverified,
    outsider,
    { id: '', cookie: '' },
  ]) {
    const response = await call(
      'POST',
      `${base()}/notification-endpoints`,
      { destination: 'client@example.com' },
      identity,
    );
    expect(response.statusCode).toBe(
      identity === outsider ? 404 : identity.cookie ? 403 : 401,
    );
  }
  expect(
    (await call('GET', `${base()}/notification-endpoints`, undefined, outsider))
      .statusCode,
  ).toBe(404);
  expect(
    (
      await call('GET', `${base()}/notification-endpoints`, undefined, member)
    ).json().canManage,
  ).toBe(false);
  expect(
    (
      await call(
        'PATCH',
        `${base()}/notification-settings`,
        { includeMembers: false },
        admin,
      )
    ).statusCode,
  ).toBe(200);
  expect(
    (
      await app.inject({
        method: 'PATCH',
        url: `/api/v1${base()}/notification-settings`,
        headers: {
          cookie: owner.cookie,
          origin: 'https://untrusted.example.com',
        },
        payload: { includeMembers: false },
      })
    ).statusCode,
  ).toBe(403);
});
it('normalizes addresses, hides hashes, validates strict payloads and records true audit actors', async () => {
  const endpoint = await add('CLIENT@example.com');
  expect(endpoint.destination).toBe('client@example.com');
  const data = await configuration();
  expect(JSON.stringify(data)).not.toContain('tokenHash');
  expect(
    (
      await call('POST', `${base()}/notification-endpoints`, {
        destination: 'client@example.com',
      })
    ).statusCode,
  ).toBe(409);
  for (const extra of [
    { verifiedAt: new Date().toISOString() },
    { organizationId: randomUUID() },
    { enabled: true },
    { actorUserId: outsider.id },
  ])
    expect(
      (
        await call('POST', `${base()}/notification-endpoints`, {
          destination: 'other@example.com',
          ...extra,
        })
      ).statusCode,
    ).toBe(400);
  const logs = await database.db
    .select()
    .from(schema.auditLogs)
    .where(eq(schema.auditLogs.organizationId, organizationId));
  expect(
    logs.find((row) => row.action === 'notification.endpoint.created'),
  ).toMatchObject({
    actorUserId: owner.id,
    metadata: { endpointId: endpoint.id },
  });
  expect(JSON.stringify(logs)).not.toContain(proof().token);
});
it('verifies without a session, rejects replay/expiry and invalidates earlier resend tokens', async () => {
  const endpoint = await add();
  const previous = proof();
  await expireCooldown(endpoint.id);
  expect(
    (
      await call(
        'POST',
        `${base()}/notification-endpoints/${endpoint.id}/resend`,
        {},
      )
    ).statusCode,
  ).toBe(200);
  expect(
    (await call('POST', '/notification-endpoints/verify', previous)).statusCode,
  ).toBe(400);
  await verify();
  expect((await configuration()).endpoints[0].verifiedAt).toBeTruthy();
  expect(
    (await call('POST', '/notification-endpoints/verify', proof())).statusCode,
  ).toBe(400);
  const second = await add('expired@example.com');
  await database.db
    .update(schema.notificationEndpoints)
    .set({ tokenExpiresAt: new Date(0) })
    .where(eq(schema.notificationEndpoints.id, second.id));
  expect(
    (await call('POST', '/notification-endpoints/verify', proof())).statusCode,
  ).toBe(400);
});
it('enforces persistent recipient and workspace mail limits; tests require verified enabled recipients', async () => {
  const endpoint = await add();
  const path = `${base()}/notification-endpoints/${endpoint.id}`;
  expect((await call('POST', `${path}/resend`, {})).statusCode).toBe(429);
  await expireCooldown(endpoint.id);
  expect((await call('POST', `${path}/test`, {})).statusCode).toBe(409);
  await verify();
  expect((await call('POST', `${path}/test`, {})).statusCode).toBe(200);
  expect(mails.at(-1)!.kind).toBe('notification-test');
  await expireCooldown(endpoint.id);
  await call('PATCH', path, { enabled: false });
  expect((await call('POST', `${path}/test`, {})).statusCode).toBe(409);
  await database.db
    .update(schema.notificationSettings)
    .set({ mailCount: 10, mailWindowAt: new Date() })
    .where(eq(schema.notificationSettings.organizationId, organizationId));
  expect(
    (
      await call('POST', `${base()}/notification-endpoints`, {
        destination: 'budget@example.com',
      })
    ).statusCode,
  ).toBe(429);
});
it('bounds active endpoints and prevents cross-tenant endpoint ID substitution on every action', async () => {
  const endpoint = await add();
  for (const [method, suffix, payload] of [
    ['PATCH', '', { enabled: false }],
    ['DELETE', '', {}],
    ['POST', '/resend', {}],
    ['POST', '/test', {}],
  ] as const)
    expect(
      (
        await call(
          method,
          `${base()}/notification-endpoints/${endpoint.id}${suffix}`,
          payload,
          outsider,
        )
      ).statusCode,
    ).toBe(404);
  await database.db.insert(schema.notificationEndpoints).values(
    Array.from({ length: 19 }, (_, index) => ({
      organizationId,
      destination: `bounded-${index}@example.com`,
    })),
  );
  expect(
    (
      await call('POST', `${base()}/notification-endpoints`, {
        destination: 'over@example.com',
      })
    ).statusCode,
  ).toBe(409);
});
it('keeps saved recipients on mail failure, supports retry and revokes deleted proof', async () => {
  mailer.mockRejectedValueOnce(new Error('secret provider detail'));
  const response = await call('POST', `${base()}/notification-endpoints`, {
    destination: 'failure@example.com',
  });
  expect(response.statusCode).toBe(502);
  expect(response.body).not.toContain('secret provider');
  const endpoint = (await configuration()).endpoints[0];
  await expireCooldown(endpoint.id);
  expect(
    (
      await call(
        'POST',
        `${base()}/notification-endpoints/${endpoint.id}/resend`,
        {},
      )
    ).statusCode,
  ).toBe(200);
  await call('DELETE', `${base()}/notification-endpoints/${endpoint.id}`, {});
  expect(
    (await call('POST', '/notification-endpoints/verify', proof())).statusCode,
  ).toBe(400);
});
it.each([true, false])(
  'applies member preference %s and endpoint policy to Connector loss/recovery',
  async (includeMembers) => {
    const endpoint = await add('notification-owner@example.com');
    await verify();
    await add('pending@example.com');
    await call('PATCH', `${base()}/notification-settings`, { includeMembers });
    const token = randomBytes(32).toString('base64url');
    const [site] = await database.db
      .insert(schema.sites)
      .values({
        organizationId,
        name: 'Connector policy fixture',
        canonicalUrl: 'https://connector-policy.example.com',
        hostname: 'connector-policy.example.com',
        status: 'active',
        lastSeenAt: new Date(0),
      })
      .returning();
    await database.db
      .insert(schema.siteCredentials)
      .values({ siteId: site!.id, credentialHash: hashCredential(token) });
    const counts = await Promise.all([
      expireHeartbeats(database.db),
      expireHeartbeats(database.db),
    ]);
    expect(counts.reduce((sum, count) => sum + count, 0)).toBe(1);
    expect(await expireHeartbeats(database.db)).toBe(0);
    const deliveries = () =>
      database.db
        .select()
        .from(schema.notificationDeliveries)
        .where(
          eq(schema.notificationDeliveries.organizationId, organizationId),
        );
    const opened = await deliveries();
    expect(opened).toHaveLength(includeMembers ? 3 : 1);
    expect(
      opened.every(
        (row) => row.monitorType === 'stale_data' && row.eventType === 'opened',
      ),
    ).toBe(true);
    expect(
      opened.filter((row) => row.recipient === endpoint.destination),
    ).toHaveLength(1);
    expect(
      opened.some((row) =>
        [
          'pending@example.com',
          'notification-outsider@example.com',
          'notification-unverified@example.com',
        ].includes(row.recipient),
      ),
    ).toBe(false);
    await call('PATCH', `${base()}/notification-endpoints/${endpoint.id}`, {
      enabled: false,
    });
    const heartbeat = (sequence: number) =>
      app.inject({
        method: 'POST',
        url: '/api/v1/connector/heartbeat',
        headers: { origin, authorization: `Bearer ${token}` },
        payload: { siteId: site!.id, sequence, connectorVersion: '0.1.0' },
      });
    expect((await heartbeat(1)).statusCode).toBe(200);
    expect((await heartbeat(1)).statusCode).toBe(409);
    expect((await heartbeat(2)).statusCode).toBe(200);
    const recovered = (await deliveries()).filter(
      (row) => row.eventType === 'recovered',
    );
    expect(recovered).toHaveLength(includeMembers ? 2 : 0);
    expect(
      recovered.some((row) => row.recipient === endpoint.destination),
    ).toBe(false);
  },
);
it('deduplicates verified endpoints against members and queues opening/recovery only for eligible recipients', async () => {
  const endpoint = await add('notification-owner@example.com');
  await verify();
  await add('pending@example.com');
  await database.db.insert(schema.sites).values({
    organizationId,
    name: 'Notifications site',
    canonicalUrl: 'https://notification.example.com',
    hostname: 'notification.example.com',
    status: 'active',
  });
  const [site] = await database.db
    .select()
    .from(schema.sites)
    .where(eq(schema.sites.organizationId, organizationId));
  await database.db.insert(schema.siteCredentials).values({
    siteId: site!.id,
    credentialHash: randomBytes(32).toString('hex'),
  });
  await seedMonitorJobs(database.db);
  async function tick(up: boolean) {
    await database.db
      .update(schema.monitorJobs)
      .set({ nextRunAt: new Date(0) })
      .where(eq(schema.monitorJobs.siteId, site!.id));
    const jobs = await claimMonitorJobs(database.db);
    for (const job of jobs)
      await finishMonitorJob(
        database.db,
        job,
        {
          result: up ? 'up' : 'down',
          httpStatus: up ? 200 : 503,
          latencyMs: 5,
          ...(!up ? { errorCode: 'HTTP_STATUS' } : {}),
        },
        { MONITOR_INTERVAL_SECONDS: 900, SSL_INTERVAL_SECONDS: 86400 },
      );
  }
  await tick(false);
  await tick(false);
  await tick(false);
  await tick(true);
  await tick(true);
  const deliveries = await database.db
    .select()
    .from(schema.notificationDeliveries)
    .where(eq(schema.notificationDeliveries.organizationId, organizationId));
  const uptime = deliveries.filter((row) => row.monitorType === 'uptime');
  expect(uptime).toHaveLength(6); // Three verified members, two events; owner deduplicated.
  expect(
    uptime.filter((row) => row.recipient === endpoint.destination),
  ).toHaveLength(2);
  expect(uptime.every((row) => row.recipient !== 'pending@example.com')).toBe(
    true,
  );
  const ownerDelivery = uptime.find((row) => row.endpointId === endpoint.id)!;
  expect(await recipientStillEnabled(database.db, ownerDelivery)).toBe(true);
  await call('PATCH', `${base()}/notification-endpoints/${endpoint.id}`, {
    enabled: false,
  });
  expect(await recipientStillEnabled(database.db, ownerDelivery)).toBe(false);
  await call('PATCH', `${base()}/notification-settings`, {
    includeMembers: false,
  });
  expect(
    await recipientStillEnabled(
      database.db,
      uptime.find((row) => !row.endpointId)!,
    ),
  ).toBe(false);
  await call('DELETE', `${base()}/notification-endpoints/${endpoint.id}`, {});
  expect(await recipientStillEnabled(database.db, ownerDelivery)).toBe(false);
  // Isolate this batch from other test fixtures, and prove suppressed rows never call the provider.
  await database.db
    .update(schema.notificationDeliveries)
    .set({ status: 'sent' });
  await database.db
    .update(schema.notificationDeliveries)
    .set({ status: 'queued' })
    .where(eq(schema.notificationDeliveries.id, ownerDelivery.id));
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  try {
    await deliverNotificationBatch(database.db, {
      AUTH_MAIL_TRANSPORT: 'resend',
      AUTH_MAIL_FROM: 'alerts@example.com',
      RESEND_API_KEY: 'test-only',
      APP_ORIGIN: origin,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
  }
  const [suppressed] = await database.db
    .select()
    .from(schema.notificationDeliveries)
    .where(eq(schema.notificationDeliveries.id, ownerDelivery.id));
  expect(suppressed!.lastErrorCode).toBe('RECIPIENT_DISABLED');
});
