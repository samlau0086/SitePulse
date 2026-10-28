import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { and, createDatabase, eq, schema, sql } from '@sitepulse/database';
import { migrateDatabase } from '@sitepulse/database/migrate';
import { parseEnvironment } from '@sitepulse/config';
import { buildApp } from '../src/app';
import { expireHeartbeats } from '../../worker/src/heartbeat';
import { runSecurityAssessment } from '../../worker/src/security';

const origin = 'http://localhost:3000';
let app: Awaited<ReturnType<typeof buildApp>>;
let database: ReturnType<typeof createDatabase>;
let owner: { id: string; cookie: string };
let outsider: { id: string; cookie: string };
let organizationId: string;
let siteId: string;
let credential: string;
let challenge: string;
const canonicalUrl = 'https://wp.customer-domain.com/blog';
function call(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  payload?: object,
  cookie = owner?.cookie,
  bearer?: string,
) {
  return app.inject({
    method,
    url: `/api/v1${path}`,
    headers: {
      origin,
      ...(cookie ? { cookie } : {}),
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
    },
    ...(payload ? { payload } : {}),
  });
}
const heartbeat = (sequence: number, token = credential, target = siteId) =>
  call(
    'POST',
    '/connector/heartbeat',
    { siteId: target, sequence, connectorVersion: '0.1.0' },
    '',
    token,
  );
const pair = (code = challenge, url = canonicalUrl) =>
  call('POST', '/connector/pair', { challenge: code, canonicalUrl: url }, '');
async function issue() {
  const response = await call(
    'POST',
    `/sites/${siteId}/pairing-challenges`,
    {},
  );
  expect(response.statusCode, response.body).toBe(200);
  challenge = response.json().challenge;
  return challenge;
}
async function signup(email: string) {
  const response = await call(
    'POST',
    '/auth/register',
    { email, password: 'connector test passphrase', name: 'Connector user' },
    '',
  );
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
    resolveHost: async (host) =>
      host.startsWith('private.') ? ['10.0.0.1'] : ['8.8.8.8'],
  });
  owner = await signup('connector-owner@example.com');
  outsider = await signup('connector-outsider@example.com');
  const response = await call('POST', '/organizations', {
    name: 'Connector agency',
    slug: 'connector-agency',
  });
  organizationId = response.json().organization.id;
  // Connector isolation fixtures need several sites; quota behavior has its own suite.
  await database.db
    .update(schema.organizations)
    .set({ planCode: 'pro' })
    .where(eq(schema.organizations.id, organizationId));
});
afterAll(async () => {
  await app?.close();
  await database?.pool.end();
});

it('requires verified email, trusted Origin and rejects forged tenant fields', async () => {
  expect(
    (
      await call('POST', `/organizations/${organizationId}/sites`, {
        name: 'WP',
        canonicalUrl,
      })
    ).statusCode,
  ).toBe(403);
  await database.db
    .update(schema.users)
    .set({ emailVerified: true, emailVerifiedAt: new Date() });
  expect(
    (
      await app.inject({
        method: 'POST',
        url: `/api/v1/organizations/${organizationId}/sites`,
        headers: { cookie: owner.cookie },
        payload: { name: 'WP', canonicalUrl },
      })
    ).statusCode,
  ).toBe(403);
  expect(
    (
      await call('POST', `/organizations/${organizationId}/sites`, {
        name: 'WP',
        canonicalUrl,
        organizationId: randomUUID(),
        role: 'owner',
      })
    ).statusCode,
  ).toBe(400);
});
it('creates a normalized tenant-owned site and rejects private DNS and duplicates', async () => {
  const response = await call(
    'POST',
    `/organizations/${organizationId}/sites`,
    { name: 'WP', canonicalUrl: `${canonicalUrl}/` },
  );
  expect(response.statusCode, response.body).toBe(201);
  siteId = response.json().site.id;
  expect(response.json().site).toMatchObject({
    canonicalUrl,
    status: 'pending',
    organizationId,
  });
  expect(
    (
      await call('POST', `/organizations/${organizationId}/sites`, {
        name: 'Duplicate',
        canonicalUrl,
      })
    ).statusCode,
  ).toBe(409);
  expect(
    (
      await call('POST', `/organizations/${organizationId}/sites`, {
        name: 'Private',
        canonicalUrl: 'https://private.customer-domain.com',
      })
    ).statusCode,
  ).toBe(400);
});
it('hides every site route and organization site route from another tenant', async () => {
  for (const [method, suffix, body] of [
    ['GET', '', undefined],
    ['PATCH', '', { name: 'Stolen' }],
    ['DELETE', '', {}],
    ['POST', '/pairing-challenges', {}],
    ['POST', '/rotate-credential', {}],
    ['POST', '/disconnect', {}],
  ] as const) {
    const response = await call(
      method,
      `/sites/${siteId}${suffix}`,
      body,
      outsider.cookie,
    );
    expect(response.statusCode, response.body).toBe(404);
    expect(response.body).not.toContain(canonicalUrl);
  }
  expect(
    (
      await call(
        'GET',
        `/organizations/${organizationId}/sites`,
        undefined,
        outsider.cookie,
      )
    ).statusCode,
  ).toBe(404);
  expect(
    (
      await call(
        'POST',
        `/organizations/${organizationId}/sites`,
        { name: 'Stolen', canonicalUrl },
        outsider.cookie,
      )
    ).statusCode,
  ).toBe(404);
  expect(
    (await call('GET', `/sites/${siteId}`, undefined, '')).statusCode,
  ).toBe(401);
});
it('lets members read but requires owner/admin for every mutation and observes revocation', async () => {
  await database.db
    .insert(schema.organizationMembers)
    .values({ organizationId, userId: outsider.id, role: 'member' });
  expect(
    (await call('GET', `/sites/${siteId}`, undefined, outsider.cookie))
      .statusCode,
  ).toBe(200);
  for (const [method, suffix] of [
    ['PATCH', ''],
    ['DELETE', ''],
    ['POST', '/pairing-challenges'],
    ['POST', '/rotate-credential'],
    ['POST', '/disconnect'],
  ] as const) {
    expect(
      (
        await call(
          method,
          `/sites/${siteId}${suffix}`,
          method === 'PATCH' ? { name: 'No' } : {},
          outsider.cookie,
        )
      ).statusCode,
    ).toBe(403);
  }
  expect(
    (
      await call(
        'POST',
        `/organizations/${organizationId}/sites`,
        { name: 'No', canonicalUrl },
        outsider.cookie,
      )
    ).statusCode,
  ).toBe(403);
  await database.db
    .update(schema.organizationMembers)
    .set({ role: 'admin' })
    .where(eq(schema.organizationMembers.userId, outsider.id));
  expect(
    (
      await call(
        'PATCH',
        `/sites/${siteId}`,
        { name: 'Renamed by admin' },
        outsider.cookie,
      )
    ).statusCode,
  ).toBe(200);
  await database.db
    .delete(schema.organizationMembers)
    .where(eq(schema.organizationMembers.userId, outsider.id));
  expect(
    (await call('GET', `/sites/${siteId}`, undefined, outsider.cookie))
      .statusCode,
  ).toBe(404);
});
async function verifySecurityAssessment(
  send: (body: object) => ReturnType<typeof call>,
  payload: { wordpressVersion: string },
) {
  await database.db
    .update(schema.siteSecurityAssessments)
    .set({
      status: 'current',
      nextCheckAt: new Date(Date.now() + 86400000),
      checkedAt: new Date(),
      coverage: 'complete',
    })
    .where(eq(schema.siteSecurityAssessments.siteId, siteId));
  expect((await send(payload)).statusCode).toBe(200);
  const [unchanged] = await database.db
    .select()
    .from(schema.siteSecurityAssessments)
    .where(eq(schema.siteSecurityAssessments.siteId, siteId));
  expect(unchanged!.status).toBe('current');
  expect(unchanged!.nextCheckAt.getTime()).toBeGreaterThan(Date.now());
  await database.db
    .update(schema.sites)
    .set({ status: 'active' })
    .where(eq(schema.sites.id, siteId));
  await database.db
    .update(schema.siteSecurityAssessments)
    .set({ nextCheckAt: new Date(0) })
    .where(eq(schema.siteSecurityAssessments.siteId, siteId));
  let replaced = false;
  const fakeProvider: typeof fetch = async () => {
    if (!replaced) {
      replaced = true;
      expect(
        (await send({ ...payload, wordpressVersion: '6.9.0' })).statusCode,
      ).toBe(200);
    }
    return Response.json({
      error: 0,
      data: { name: 'Example', vulnerability: null },
    });
  };
  expect(await runSecurityAssessment(database.db, fakeProvider)).toBe(1);
  const [invalidated] = await database.db
    .select()
    .from(schema.siteSecurityAssessments)
    .where(eq(schema.siteSecurityAssessments.siteId, siteId));
  expect(invalidated).toMatchObject({
    status: 'pending',
    leaseToken: null,
    coverage: 'unknown',
    vulnerabilities: [],
  });
  expect(await runSecurityAssessment(database.db, fakeProvider)).toBe(1);
  expect((await call('GET', `/sites/${siteId}`)).json().security).toMatchObject(
    { status: 'current', coverage: { publicVulnerabilities: 'partial' } },
  );
  await database.db
    .update(schema.siteSecurityAssessments)
    .set({ nextCheckAt: new Date(0) })
    .where(eq(schema.siteSecurityAssessments.siteId, siteId));
  let overflowSent = false;
  const oversizedProvider: typeof fetch = async () =>
    new Response(
      new ReadableStream({
        pull(controller) {
          if (!overflowSent) {
            overflowSent = true;
            controller.enqueue(new Uint8Array(1_000_001));
          } else controller.close();
        },
      }),
    );
  expect(await runSecurityAssessment(database.db, oversizedProvider)).toBe(1);
  expect((await call('GET', `/sites/${siteId}`)).json().security).toMatchObject(
    {
      status: 'unavailable',
      errorCode: 'advisory_provider_unavailable',
      coverage: { publicVulnerabilities: 'unknown' },
    },
  );
}
it('issues only a hashed short-lived challenge and invalidates older codes', async () => {
  const old = await issue();
  await issue();
  expect((await pair(old)).statusCode).toBe(400);
  const rows = await database.db.select().from(schema.pairingChallenges);
  expect(rows).toHaveLength(1);
  expect(JSON.stringify(rows)).not.toContain(challenge);
  expect(rows[0]!.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(600000);
});
it('rejects wrong site identity, expired and forged challenges', async () => {
  expect(
    (await pair(challenge, 'https://other.customer-domain.com')).statusCode,
  ).toBe(400);
  expect((await pair(randomBytes(32).toString('base64url'))).statusCode).toBe(
    400,
  );
  await database.db
    .update(schema.pairingChallenges)
    .set({ expiresAt: new Date(0) });
  expect((await pair()).statusCode).toBe(400);
});
it('consumes a challenge once even with concurrent pairing and stores only credential hash', async () => {
  await issue();
  const results = await Promise.all([pair(), pair()]);
  expect(results.map((r) => r.statusCode).sort()).toEqual([200, 400]);
  const response = results.find((r) => r.statusCode === 200)!;
  credential = response.json().credential;
  expect(response.json()).toMatchObject({
    siteId,
    heartbeatIntervalSeconds: 900,
  });
  expect(credential).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(
    JSON.stringify(await database.db.select().from(schema.siteCredentials)),
  ).not.toContain(credential);
  expect((await pair()).statusCode).toBe(400);
});
it('rejects forged, absent and cross-site connector credentials', async () => {
  expect(
    (await heartbeat(1, randomBytes(32).toString('base64url'))).statusCode,
  ).toBe(401);
  expect(
    (
      await call(
        'POST',
        '/connector/heartbeat',
        { siteId, sequence: 1, connectorVersion: '0.1.0' },
        '',
      )
    ).statusCode,
  ).toBe(401);
  const other = await call('POST', `/organizations/${organizationId}/sites`, {
    name: 'Other site',
    canonicalUrl: 'https://other.customer-domain.com',
  });
  expect(
    (await heartbeat(1, credential, other.json().site.id)).statusCode,
  ).toBe(401);
  expect((await heartbeat(1, credential, randomUUID())).statusCode).toBe(401);
});
it('migrates inventory idempotently and returns an empty snapshot before reporting', async () => {
  await migrateDatabase(database.db);
  const response = await call('GET', `/sites/${siteId}`);
  expect(response.statusCode, response.body).toBe(200);
  expect(response.json()).toMatchObject({
    site: { id: siteId },
    inventory: null,
  });
});
it('stores and replaces inventory with server receipt time and enforces tenant and credential isolation', async () => {
  const payload = {
    siteId,
    wordpressVersion: '6.7.1',
    phpVersion: '8.3.4',
    activePlugins: [
      { identifier: 'example', name: 'Example', version: '1.0.0' },
    ],
    activeThemes: [{ identifier: 'theme', name: 'Theme', version: '1.0.0' }],
    installedPlugins: [
      {
        identifier: 'example',
        name: 'Example',
        version: '1.0.0',
        active: true,
        updateVersion: '1.1.0',
        source: 'wordpress.org',
      },
    ],
    installedThemes: [
      {
        identifier: 'theme',
        name: 'Theme',
        version: '1.0.0',
        active: true,
        updateVersion: null,
        source: 'unknown',
      },
    ],
    environment: {
      environmentType: 'production',
      multisite: false,
      wpDebug: true,
      wpDebugDisplay: false,
      scriptDebug: false,
      disallowFileEdit: false,
      forceSslAdmin: true,
      wpCronDisabled: false,
    },
    localSecurityScan: {
      status: 'complete',
      scannedFiles: 12,
      skippedFiles: 0,
      findings: [{ rule: 'php_in_uploads', path: 'uploads/image.php' }],
    },
    updateCounts: { plugins: 1, themes: 0, core: 0 },
  };
  const send = (body: object, token = credential) =>
    call('POST', '/connector/inventory', body, '', token);
  expect((await send(payload, '')).statusCode).toBe(401);
  expect(
    (await send(payload, randomBytes(32).toString('base64url'))).statusCode,
  ).toBe(401);
  expect((await send({ ...payload, siteId: randomUUID() })).statusCode).toBe(
    401,
  );
  const other = await call('POST', `/organizations/${organizationId}/sites`, {
    name: 'Inventory isolation',
    canonicalUrl: 'https://inventory.customer-domain.com',
  });
  expect(other.statusCode, other.body).toBe(201);
  expect(
    (await send({ ...payload, siteId: other.json().site.id })).statusCode,
  ).toBe(401);
  expect(
    (await send({ ...payload, receivedAt: '2099-01-01' })).statusCode,
  ).toBe(400);
  expect(
    (
      await send({
        ...payload,
        activePlugins: Array(201).fill(payload.activePlugins[0]),
      })
    ).statusCode,
  ).toBe(400);
  expect(
    (await send({ ...payload, wordpressVersion: 'invalid' })).statusCode,
  ).toBe(400);
  const before = Date.now();
  const written = await send(payload);
  expect(written.statusCode, written.body).toBe(200);
  expect(new Date(written.json().receivedAt).getTime()).toBeGreaterThanOrEqual(
    before - 1000,
  );
  const response = await call('GET', `/sites/${siteId}`);
  expect(response.statusCode, response.body).toBe(200);
  expect(response.json().inventory).toMatchObject(payload);
  expect(response.json().inventory.receivedAt).toBe(written.json().receivedAt);
  expect(response.json().security).toMatchObject({
    status: 'pending',
    coverage: { inventory: 'complete', localFiles: 'complete' },
    localFindings: [{ rule: 'php_in_uploads', path: 'uploads/image.php' }],
  });
  expect(response.json().security.environmentRisks).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ code: 'wp_debug_enabled' }),
      expect.objectContaining({ code: 'dashboard_file_editor' }),
    ]),
  );
  expect(
    (await call('GET', `/sites/${siteId}`, undefined, outsider.cookie))
      .statusCode,
  ).toBe(404);
  expect(
    (await send({ ...payload, wordpressVersion: '6.8.0' })).statusCode,
  ).toBe(200);
  const rows = await database.db
    .select()
    .from(schema.siteInventorySnapshots)
    .where(eq(schema.siteInventorySnapshots.siteId, siteId));
  expect(rows).toHaveLength(1);
  expect(rows[0]?.wordpressVersion).toBe('6.8.0');
  await verifySecurityAssessment(send, {
    ...payload,
    wordpressVersion: '6.8.0',
  });
});
it('accepts heartbeat with server time and rejects replay without refreshing freshness', async () => {
  const before = Date.now();
  expect((await heartbeat(1)).statusCode).toBe(200);
  const site = (await call('GET', `/sites/${siteId}`)).json().site;
  expect(site.status).toBe('active');
  expect(new Date(site.lastSeenAt).getTime()).toBeGreaterThanOrEqual(
    before - 1000,
  );
  expect((await heartbeat(1)).statusCode).toBe(409);
  expect((await call('GET', `/sites/${siteId}`)).json().site.lastSeenAt).toBe(
    site.lastSeenAt,
  );
  expect(
    (
      await call(
        'POST',
        '/connector/heartbeat',
        {
          siteId,
          sequence: 2,
          connectorVersion: '0.1.0',
          lastSeenAt: '2099-01-01',
        },
        '',
        credential,
      )
    ).statusCode,
  ).toBe(400);
});
it('serializes concurrent sequence replay', async () => {
  const results = await Promise.all([heartbeat(2), heartbeat(2)]);
  expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
});
it('marks stale once across workers then recovers on the next valid heartbeat', async () => {
  await database.db
    .update(schema.sites)
    .set({ lastSeenAt: sql`now() - interval '2680 seconds'` })
    .where(eq(schema.sites.id, siteId));
  expect(await expireHeartbeats(database.db)).toBe(0);
  await database.db
    .update(schema.sites)
    .set({ lastSeenAt: new Date(Date.now() - 46 * 60000) })
    .where(eq(schema.sites.id, siteId));
  const counts = await Promise.all([
    expireHeartbeats(database.db),
    expireHeartbeats(database.db),
  ]);
  expect(counts.reduce((a, b) => a + b, 0)).toBe(1);
  const rows = await database.db
    .select()
    .from(schema.incidents)
    .where(
      and(
        eq(schema.incidents.siteId, siteId),
        eq(schema.incidents.monitorType, 'stale_data'),
      ),
    );
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ status: 'open', severity: 'warning' });
  const incidentId = rows[0]!.id;
  const deliveries = () =>
    database.db
      .select()
      .from(schema.notificationDeliveries)
      .where(eq(schema.notificationDeliveries.incidentId, incidentId));
  expect((await deliveries()).map((row) => row.recipient)).toEqual([
    'connector-owner@example.com',
  ]);
  expect(await expireHeartbeats(database.db)).toBe(0);
  expect((await heartbeat(2)).statusCode).toBe(409);
  expect(
    (await heartbeat(3, randomBytes(32).toString('base64url'))).statusCode,
  ).toBe(401);
  expect((await deliveries()).map((row) => row.eventType)).toEqual(['opened']);
  for (const path of [
    `/sites/${siteId}/incidents`,
    `/organizations/${organizationId}/incidents`,
  ]) {
    expect(
      (await call('GET', path, undefined, outsider.cookie)).statusCode,
    ).toBe(404);
    expect((await call('GET', path, undefined, '')).statusCode).toBe(401);
    const response = await call('GET', path);
    expect(response.statusCode).toBe(200);
    expect(
      response
        .json()
        .incidents.some(
          (row: { id: string; monitorType: string }) =>
            row.id === incidentId && row.monitorType === 'stale_data',
        ),
    ).toBe(true);
  }
  expect((await call('GET', `/sites/${siteId}`)).json().site.status).toBe(
    'degraded',
  );
  expect((await heartbeat(3)).statusCode).toBe(200);
  expect((await heartbeat(3)).statusCode).toBe(409);
  expect((await heartbeat(4)).statusCode).toBe(200);
  expect((await deliveries()).map((row) => row.eventType).sort()).toEqual([
    'opened',
    'recovered',
  ]);
  const [resolved] = await database.db
    .select()
    .from(schema.incidents)
    .where(eq(schema.incidents.id, incidentId));
  expect(resolved).toMatchObject({
    status: 'resolved',
    resolutionReason: 'recovered',
  });
  expect((await call('GET', `/sites/${siteId}`)).json().site.status).toBe(
    'active',
  );
});
it('rotation immediately revokes the old secret and requires re-pairing', async () => {
  await database.db
    .update(schema.sites)
    .set({ status: 'degraded', lastSeenAt: new Date(Date.now() - 46 * 60000) })
    .where(eq(schema.sites.id, siteId));
  // Upgrades also alert for already-degraded sites from the old worker.
  expect(await expireHeartbeats(database.db)).toBe(1);
  const [active] = await database.db
    .select()
    .from(schema.incidents)
    .where(
      and(
        eq(schema.incidents.siteId, siteId),
        eq(schema.incidents.status, 'open'),
      ),
    );
  const response = await call('POST', `/sites/${siteId}/rotate-credential`, {});
  expect(response.statusCode).toBe(200);
  const [closed] = await database.db
    .select()
    .from(schema.incidents)
    .where(eq(schema.incidents.id, active!.id));
  expect(closed).toMatchObject({
    status: 'resolved',
    resolutionReason: 'connection_reset',
  });
  expect(
    await database.db
      .select()
      .from(schema.notificationDeliveries)
      .where(
        and(
          eq(schema.notificationDeliveries.incidentId, active!.id),
          eq(schema.notificationDeliveries.eventType, 'recovered'),
        ),
      ),
  ).toHaveLength(0);
  challenge = response.json().challenge;
  expect((await heartbeat(4)).statusCode).toBe(401);
  expect(
    (
      await call(
        'POST',
        '/connector/inventory',
        {
          siteId,
          wordpressVersion: '6.7.1',
          phpVersion: '8.3.4',
          activePlugins: [],
          activeThemes: [],
          updateCounts: { plugins: 0, themes: 0, core: 0 },
        },
        '',
        credential,
      )
    ).statusCode,
  ).toBe(401);
  const paired = await pair();
  expect(paired.statusCode).toBe(200);
  expect(paired.json().credential).not.toBe(credential);
  credential = paired.json().credential;
  expect((await heartbeat(1)).statusCode).toBe(200);
});
it('expires paired sites that never send their first heartbeat', async () => {
  await issue();
  credential = (await pair()).json().credential;
  await database.db
    .update(schema.sites)
    .set({ updatedAt: new Date(Date.now() - 46 * 60000) })
    .where(eq(schema.sites.id, siteId));
  expect(await expireHeartbeats(database.db)).toBe(1);
  expect((await heartbeat(1)).statusCode).toBe(200);
});
it('disconnect invalidates credentials and challenges and does not produce stale states', async () => {
  await issue();
  expect(
    (await call('POST', `/sites/${siteId}/disconnect`, {})).statusCode,
  ).toBe(200);
  expect((await pair()).statusCode).toBe(400);
  expect((await heartbeat(2)).statusCode).toBe(401);
  expect(await expireHeartbeats(database.db)).toBe(0);
});
it('allows site-scoped connector revocation without a browser session', async () => {
  await issue();
  credential = (await pair()).json().credential;
  expect(
    (
      await call(
        'POST',
        '/connector/disconnect',
        { siteId },
        '',
        randomBytes(32).toString('base64url'),
      )
    ).statusCode,
  ).toBe(401);
  expect(
    (await call('POST', '/connector/disconnect', { siteId }, '', credential))
      .statusCode,
  ).toBe(200);
  expect((await heartbeat(2)).statusCode).toBe(401);
});
it('soft deletion hides the site, revokes the secret and permits re-registration', async () => {
  await issue();
  credential = (await pair()).json().credential;
  expect((await call('DELETE', `/sites/${siteId}`, {})).statusCode).toBe(200);
  expect((await call('GET', `/sites/${siteId}`)).statusCode).toBe(404);
  expect((await heartbeat(1)).statusCode).toBe(401);
  const list = await call('GET', `/organizations/${organizationId}/sites`);
  expect(list.body).not.toContain(siteId);
  expect(
    (
      await call('POST', `/organizations/${organizationId}/sites`, {
        name: 'Replacement',
        canonicalUrl,
      })
    ).statusCode,
  ).toBe(201);
});
it('keeps tenant responses and audit records free of credential and challenge material', async () => {
  const logs = await database.db
    .select()
    .from(schema.auditLogs)
    .where(
      and(
        eq(schema.auditLogs.organizationId, organizationId),
        sql`${schema.auditLogs.action} like 'site.%'`,
      ),
    );
  const serialized = JSON.stringify(logs);
  expect(serialized).toContain('site.paired');
  expect(serialized).toContain('site.heartbeat_stale');
  expect(serialized).not.toContain(credential);
  expect(serialized).not.toContain(challenge);
  expect(
    (await call('GET', `/organizations/${organizationId}/sites`)).body,
  ).not.toContain('credential');
});
