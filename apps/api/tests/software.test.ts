import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { createDatabase, eq, schema, sql } from '@sitepulse/database';
import { migrateDatabase } from '@sitepulse/database/migrate';
import { parseEnvironment } from '@sitepulse/config';
import { buildApp } from '../src/app';
import { hashCredential } from '../src/sites';

const origin = 'http://localhost:3000';
let app: Awaited<ReturnType<typeof buildApp>>;
let database: ReturnType<typeof createDatabase>;
let owner: { id: string; cookie: string };
let reader: { id: string; cookie: string };
let outsider: { id: string; cookie: string };
let organizationId: string;
let foreignOrg: string;
let sites: string[];
const credential = randomBytes(32).toString('base64url');
const command = { kind: 'plugin', action: 'activate', slug: 'hello-dolly' };
function call(
  method: 'POST' | 'GET',
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
const base = () => `/organizations/${organizationId}/software`;
const preview = (siteIds = sites, selectedCommand = command) =>
  call('POST', `${base()}/preview`, {
    siteIds,
    command: selectedCommand,
    reason: 'Maintenance test',
  });
const confirm = (id: string) => call('POST', `${base()}/${id}/confirm`, {});
const poll = (siteId = sites[0]!, enabled = true, bearer = credential) =>
  call('POST', '/connector/software-poll', { siteId, enabled }, '', bearer);
async function queued(siteIds = [sites[0]!]) {
  const response = await preview(siteIds);
  expect(response.statusCode, response.body).toBe(200);
  const id = response.json().batchId;
  const confirmed = await confirm(id);
  expect(confirmed.statusCode, confirmed.body).toBe(200);
  return id as string;
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
  });
  async function signup(email: string) {
    const response = await call(
      'POST',
      '/auth/register',
      {
        email,
        password: 'software management test passphrase',
        name: 'Software user',
      },
      '',
    );
    expect(response.statusCode, response.body).toBe(201);
    return {
      id: response.json().user.id as string,
      cookie: response.cookies
        .map((row) => `${row.name}=${row.value}`)
        .join('; '),
    };
  }
  owner = await signup('software-owner@example.com');
  reader = await signup('software-reader@example.com');
  outsider = await signup('software-outsider@example.com');
  await database.db.update(schema.users).set({ emailVerified: true });
  organizationId = (
    await call('POST', '/organizations', {
      name: 'Software workspace',
      slug: 'software-workspace',
    })
  ).json().organization.id;
  foreignOrg = (
    await call(
      'POST',
      '/organizations',
      { name: 'Other workspace', slug: 'other-workspace' },
      outsider.cookie,
    )
  ).json().organization.id;
  await database.db
    .insert(schema.organizationMembers)
    .values({ organizationId, userId: reader.id, role: 'member' });
});
beforeEach(async () => {
  await database.db.delete(schema.sites);
  await database.db
    .update(schema.organizationMembers)
    .set({ role: 'owner' })
    .where(eq(schema.organizationMembers.userId, owner.id));
  await database.db.update(schema.users).set({ emailVerified: true });
  sites = (
    await database.db
      .insert(schema.sites)
      .values(
        [0, 1].map((index) => ({
          organizationId,
          name: `Site ${index}`,
          canonicalUrl: `https://site${index}.example.com`,
          hostname: `site${index}.example.com`,
          status: 'active' as const,
        })),
      )
      .returning()
  ).map((site) => site.id);
  for (const siteId of sites) {
    // Each site has an independent secret, as in real pairing.
    await database.db.insert(schema.siteCredentials).values({
      siteId,
      credentialHash: hashCredential(
        siteId === sites[0]
          ? credential
          : randomBytes(32).toString('base64url'),
      ),
    });
    await database.db
      .insert(schema.siteManagement)
      .values({ siteId, enabled: true, secretVersion: 1 });
    await database.db.insert(schema.siteInventorySnapshots).values({
      siteId,
      wordpressVersion: '6.8.3',
      phpVersion: '8.3.0',
      activePlugins: [],
      activeThemes: [],
      installedPlugins: [
        {
          identifier: 'hello-dolly',
          name: 'Hello Dolly',
          version: '1.7.2',
          active: false,
          updateVersion: null,
          source: 'wordpress.org',
        },
      ],
      installedThemes: [],
      environment: {
        environmentType: 'staging',
        multisite: false,
        wpDebug: false,
        wpDebugDisplay: false,
        scriptDebug: false,
        disallowFileEdit: false,
        forceSslAdmin: true,
        wpCronDisabled: false,
        inventoryComplete: true,
      },
      updateCounts: { plugins: 0, themes: 0, core: 0 },
    });
  }
});
afterAll(async () => {
  await app?.close();
  await database?.pool.end();
});

const syncInventory = (siteId = sites[0]!, cookie = owner.cookie) =>
  call('POST', `${base()}/inventory-sync`, { siteId }, cookie);
const failInventory = (
  requestId?: string,
  siteId = sites[0]!,
  bearer = credential,
) =>
  call(
    'POST',
    '/connector/inventory-failure',
    {
      siteId,
      code: 'collection',
      ...(requestId ? { inventoryRequestId: requestId } : {}),
    },
    '',
    bearer,
  );
async function uploadInventory(requestId?: string) {
  const [snapshot] = await database.db
    .select()
    .from(schema.siteInventorySnapshots)
    .where(eq(schema.siteInventorySnapshots.siteId, sites[0]!));
  const {
    wordpressVersion,
    phpVersion,
    activePlugins,
    activeThemes,
    installedPlugins,
    installedThemes,
    environment,
    localSecurityScan,
    updateCounts,
  } = snapshot!;
  return call(
    'POST',
    '/connector/inventory',
    {
      siteId: sites[0],
      wordpressVersion,
      phpVersion,
      activePlugins,
      activeThemes,
      installedPlugins,
      installedThemes,
      environment,
      localSecurityScan,
      updateCounts,
      ...(requestId ? { inventoryRequestId: requestId } : {}),
    },
    '',
    credential,
  );
}
async function syncState() {
  const response = await call('GET', base());
  return response
    .json()
    .sites.find((site: { id: string }) => site.id === sites[0]);
}
it('authorizes inventory sync independently of software consent and hides foreign sites', async () => {
  expect((await syncInventory(sites[0], '')).statusCode).toBe(401);
  expect((await syncInventory(sites[0], reader.cookie)).statusCode).toBe(403);
  expect((await syncInventory(sites[0], outsider.cookie)).statusCode).toBe(404);
  await database.db
    .update(schema.users)
    .set({ emailVerified: false })
    .where(eq(schema.users.id, owner.id));
  expect((await syncInventory()).statusCode).toBe(403);
  await database.db
    .update(schema.users)
    .set({ emailVerified: true })
    .where(eq(schema.users.id, owner.id));
  const foreign = await database.db
    .insert(schema.sites)
    .values({
      organizationId: foreignOrg,
      name: 'Foreign',
      canonicalUrl: 'https://foreign.example.com',
      hostname: 'foreign.example.com',
      status: 'active',
    })
    .returning();
  expect((await syncInventory(foreign[0]!.id)).statusCode).toBe(404);
  expect(
    (
      await app.inject({
        method: 'POST',
        url: `/api/v1${base()}/inventory-sync`,
        headers: { cookie: owner.cookie, origin: 'https://evil.example.com' },
        payload: { siteId: sites[0] },
      })
    ).statusCode,
  ).toBe(403);
  await database.db.update(schema.siteManagement).set({ enabled: false });
  const response = await syncInventory();
  expect(response.statusCode).toBe(200);
  expect((await poll(sites[0], false)).json()).toEqual({
    command: null,
    inventoryRequestId: response.json().requestId,
  });
});
it('queues idempotently and never dispatches software together with inventory', async () => {
  await queued();
  const response = await syncInventory();
  expect((await syncInventory()).json()).toEqual(response.json());
  expect((await poll()).json()).toEqual({
    command: null,
    inventoryRequestId: response.json().requestId,
  });
  expect((await syncState()).inventorySync.status).toBe('pending');
  expect((await uploadInventory(response.json().requestId)).statusCode).toBe(
    200,
  );
  expect((await syncState()).inventorySync.status).toBe('succeeded');
  expect((await poll()).json().command.slug).toBe('hello-dolly');
  expect((await syncInventory()).statusCode).toBe(429);
});
it('queues before the first Connector poll without falsely reporting management readiness', async () => {
  await database.db
    .delete(schema.siteManagement)
    .where(eq(schema.siteManagement.siteId, sites[0]!));
  const response = await syncInventory();
  expect(response.statusCode).toBe(200);
  const site = await syncState();
  expect(site.enabled).toBe(false);
  expect(site.polledAt).toBe('1970-01-01T00:00:00.000Z');
  expect(site.inventorySync.status).toBe('pending');
  expect((await poll(sites[0], false)).json()).toEqual({
    command: null,
    inventoryRequestId: response.json().requestId,
  });
});
it('records safe inventory failures separately from healthy polling and retains last success', async () => {
  const before = (await syncState()).inventoryAt;
  const id = (await syncInventory()).json().requestId;
  expect((await failInventory(id)).statusCode).toBe(200);
  await poll();
  const site = await syncState();
  expect(site.enabled).toBe(true);
  expect(site.inventorySync.status).toBe('failed');
  expect(site.inventorySync.error).toBe('collection');
  expect(site.inventoryAt).toBe(before);
  expect(site.plugins).toHaveLength(1);
  expect((await uploadInventory()).statusCode).toBe(200);
  expect((await syncState()).inventorySync.status).toBe('succeeded');
  expect((await failInventory(id)).statusCode).toBe(404);
});
it('distinguishes no inventory from a timed out request and permits a new bounded retry', async () => {
  await database.db
    .delete(schema.siteInventorySnapshots)
    .where(eq(schema.siteInventorySnapshots.siteId, sites[0]!));
  expect((await syncState()).inventorySync.status).toBe('not_received');
  const first = (await syncInventory()).json().requestId;
  await database.db
    .update(schema.siteManagement)
    .set({ inventoryRequestedAt: new Date(Date.now() - 16 * 60_000) });
  expect((await syncState()).inventorySync.status).toBe('timed_out');
  expect((await poll()).json()).toEqual({ command: null });
  const second = (await syncInventory()).json().requestId;
  expect(second).not.toBe(first);
  expect((await failInventory(first)).statusCode).toBe(404);
  expect((await syncState()).inventorySync.status).toBe('pending');
});
it('fences inventory requests and failure reports by site and credential generation', async () => {
  const id = (await syncInventory()).json().requestId;
  expect((await failInventory(id, sites[1])).statusCode).toBe(401);
  expect((await failInventory(randomUUID())).statusCode).toBe(404);
  expect((await uploadInventory(randomUUID())).statusCode).toBe(409);
  await database.db
    .update(schema.siteCredentials)
    .set({ secretVersion: 2 })
    .where(eq(schema.siteCredentials.siteId, sites[0]!));
  expect((await failInventory(id)).statusCode).toBe(404);
  expect((await uploadInventory(id)).statusCode).toBe(409);
  expect((await poll()).json()).toEqual({ command: null });
  expect((await syncState()).inventorySync.requestedAt).toBeNull();
  const next = await syncInventory();
  expect(next.statusCode).toBe(200);
  await database.db
    .update(schema.siteCredentials)
    .set({ revokedAt: new Date() })
    .where(eq(schema.siteCredentials.siteId, sites[0]!));
  expect((await failInventory(next.json().requestId)).statusCode).toBe(401);
  expect((await syncInventory()).statusCode).toBe(409);
});

it('requires a session, verified admin, trusted Origin, and hides other tenants', async () => {
  expect((await call('GET', base(), undefined, '')).statusCode).toBe(401);
  expect(
    (await call('GET', base(), undefined, outsider.cookie)).statusCode,
  ).toBe(404);
  expect(
    (
      await call(
        'POST',
        `${base()}/preview`,
        { siteIds: sites, command, reason: 'test' },
        reader.cookie,
      )
    ).statusCode,
  ).toBe(403);
  expect(
    (await call('GET', base(), undefined, reader.cookie)).json().canManage,
  ).toBe(false);
  await database.db
    .update(schema.users)
    .set({ emailVerified: false })
    .where(eq(schema.users.id, owner.id));
  expect((await preview()).statusCode).toBe(403);
  await database.db
    .update(schema.users)
    .set({ emailVerified: true })
    .where(eq(schema.users.id, owner.id));
  const foreignSite = (
    await database.db
      .insert(schema.sites)
      .values({
        organizationId: foreignOrg,
        name: 'Foreign',
        canonicalUrl: 'https://foreign.example.com',
        hostname: 'foreign.example.com',
      })
      .returning()
  )[0]!;
  expect((await preview([sites[0]!, foreignSite.id])).statusCode).toBe(404);
  expect(
    await database.db.select().from(schema.softwareOperations),
  ).toHaveLength(0);
  expect(
    (
      await app.inject({
        method: 'POST',
        url: `/api/v1${base()}/preview`,
        headers: { cookie: owner.cookie },
        payload: { siteIds: sites, command, reason: 'test' },
      })
    ).statusCode,
  ).toBe(403);
});
it('previews and confirms a batch once, with per-site results and no tokens in reads', async () => {
  const id = await queued();
  expect((await confirm(id)).statusCode).toBe(200);
  expect(
    await database.db.select().from(schema.softwareOperations),
  ).toHaveLength(1);
  const response = await poll();
  expect(response.statusCode, response.body).toBe(200);
  const cmd = response.json().command;
  expect(cmd).toMatchObject(command);
  expect((await poll()).json().command).toBeNull();
  const body = {
    siteId: sites[0],
    operationId: cmd.id,
    token: cmd.token,
    code: 'ok',
  };
  expect(
    (await call('POST', '/connector/software-result', body, '', credential))
      .statusCode,
  ).toBe(200);
  expect(
    (await call('POST', '/connector/software-result', body, '', credential))
      .statusCode,
  ).toBe(200);
  expect(
    (
      await call(
        'POST',
        '/connector/software-result',
        { ...body, code: 'uncertain' },
        '',
        credential,
      )
    ).statusCode,
  ).toBe(409);
  const list = await call('GET', base());
  expect(list.json().operations[0].status).toBe('succeeded');
  expect(list.body).not.toContain(cmd.token);
  expect(list.body).not.toContain(hashCredential(credential));
  const logs = await database.db.select().from(schema.auditLogs);
  expect(logs.some((log) => log.action === 'software.completed')).toBe(true);
  expect(JSON.stringify(logs)).not.toContain(cmd.token);
});
it('serializes concurrent confirmations and concurrent claims', async () => {
  const first = (await preview([sites[0]!])).json().batchId;
  const second = (await preview([sites[0]!])).json().batchId;
  const responses = await Promise.all([confirm(first), confirm(second)]);
  expect(responses.map((row) => row.statusCode).sort()).toEqual([200, 409]);
  const claims = await Promise.all([poll(), poll()]);
  expect(claims.filter((row) => row.json().command)).toHaveLength(1);
});
it('keeps batches tenant-scoped, enforces actor identity and permits member reads only', async () => {
  const response = await preview();
  const batchId = response.json().batchId;
  expect(
    (await call('POST', `${base()}/${batchId}/confirm`, {}, outsider.cookie))
      .statusCode,
  ).toBe(404);
  expect(
    (await call('POST', `${base()}/${batchId}/confirm`, {}, reader.cookie))
      .statusCode,
  ).toBe(403);
  expect(
    (
      await call(
        'POST',
        `/organizations/${foreignOrg}/software/${batchId}/confirm`,
        {},
        outsider.cookie,
      )
    ).statusCode,
  ).toBe(404);
  expect((await confirm(batchId)).statusCode).toBe(200);
  expect((await call('GET', base())).json().operations).toHaveLength(2);
});
it('requires opt-in and fresh complete inventory; rejects unsafe slugs and connector changes', async () => {
  expect((await preview(sites, { ...command, slug: '../a' })).statusCode).toBe(
    400,
  );
  expect(
    (await preview(sites, { ...command, slug: 'sitepulse-connector' }))
      .statusCode,
  ).toBe(409);
  await database.db.update(schema.siteManagement).set({ enabled: false });
  expect((await preview()).statusCode).toBe(409);
  await database.db.update(schema.siteManagement).set({ enabled: true });
  await database.db
    .update(schema.siteInventorySnapshots)
    .set({ receivedAt: new Date(Date.now() - 61 * 60_000) });
  expect((await preview()).statusCode).toBe(409);
});
it('invalidates changed previews and expires unstarted operations', async () => {
  const batchId = (await preview()).json().batchId;
  await database.db.update(schema.siteCredentials).set({ secretVersion: 2 });
  expect((await confirm(batchId)).statusCode).toBe(409);
  await database.db.update(schema.siteCredentials).set({ secretVersion: 1 });
  await database.db
    .update(schema.softwareOperations)
    .set({ expiresAt: new Date(0) });
  expect((await confirm(batchId)).statusCode).toBe(409);
  expect(
    (await call('GET', base()))
      .json()
      .operations.every((row: { status: string }) => row.status === 'expired'),
  ).toBe(true);
});
it('rechecks membership, credential version and opt-in at dispatch', async () => {
  await queued();
  await database.db
    .update(schema.organizationMembers)
    .set({ role: 'member' })
    .where(eq(schema.organizationMembers.userId, owner.id));
  expect((await poll()).json().command).toBeNull();
  expect((await call('GET', base())).json().operations[0].status).toBe(
    'cancelled',
  );
});
it('rejects cross-site claims, forged results and revoked/rotated credentials', async () => {
  await queued();
  expect((await poll(sites[1])).statusCode).toBe(401);
  const cmd = (await poll()).json().command;
  const body = {
    siteId: sites[0],
    operationId: cmd.id,
    token: 'a'.repeat(43),
    code: 'ok',
  };
  expect(
    (await call('POST', '/connector/software-result', body, '', credential))
      .statusCode,
  ).toBe(404);
  await database.db
    .update(schema.siteCredentials)
    .set({ revokedAt: new Date() });
  expect((await poll()).statusCode).toBe(401);
  expect(
    (
      await call(
        'POST',
        '/connector/software-result',
        { ...body, token: cmd.token },
        '',
        credential,
      )
    ).statusCode,
  ).toBe(401);
});
it('cancels on local opt-out and permits cancelling queued batches', async () => {
  const id = await queued(sites);
  expect((await poll(sites[0], false)).json().command).toBeNull();
  expect((await call('POST', `${base()}/${id}/cancel`, {})).statusCode).toBe(
    200,
  );
  expect(
    (await call('GET', base()))
      .json()
      .operations.every(
        (row: { status: string }) => row.status === 'cancelled',
      ),
  ).toBe(true);
});
it('never reassigns timed-out work and requires explicit review before more work', async () => {
  const id = await queued();
  const cmd = (await poll()).json().command;
  await database.db
    .update(schema.softwareOperations)
    .set({ startedAt: new Date(Date.now() - 16 * 60_000) });
  expect((await poll()).json().command).toBeNull();
  expect((await call('GET', base())).json().operations[0].status).toBe(
    'unknown',
  );
  const next = (await preview([sites[0]!])).json().batchId;
  expect((await confirm(next)).statusCode).toBe(409);
  expect((await call('POST', `${base()}/${id}/resolve`, {})).statusCode).toBe(
    200,
  );
  expect((await confirm(next)).statusCode).toBe(200);
  expect(
    (
      await call(
        'POST',
        '/connector/software-result',
        { siteId: sites[0], operationId: cmd.id, token: cmd.token, code: 'ok' },
        '',
        credential,
      )
    ).statusCode,
  ).toBe(409);
});
