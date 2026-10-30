import { randomBytes, randomUUID } from 'node:crypto';
import { symmetricEncrypt } from 'better-auth/crypto';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { and, createDatabase, eq, schema, sql } from '@sitepulse/database';
import { migrateDatabase } from '@sitepulse/database/migrate';
import { parseEnvironment } from '@sitepulse/config';
import { buildApp } from '../src/app';
import { hashCredential } from '../src/sites';
import { pluginFixture, packageFixture } from '../src/package-fixture';

const origin = 'http://localhost:3000';
const authSecret = randomBytes(48).toString('base64url');
const driveFiles = new Map<string, Buffer>();
const driveRequests: string[] = [];
let hostileDriveSession = false;
let driveDownloadFailure: number | 'network' | undefined;
let driveTransportError: Error | undefined;
const driveFetch: typeof fetch = async (input, init) => {
  const url = new URL(String(input));
  driveRequests.push(url.href);
  expect(url.origin).toBe('https://www.googleapis.com');
  expect(init?.redirect).toBe('manual');
  expect(new Headers(init?.headers).get('authorization')).toBe(
    'Bearer fixture-access',
  );
  if (url.pathname.endsWith('/generateIds'))
    return Response.json({ ids: ['drive-fixture'] });
  if (init?.method === 'POST')
    return new Response(null, {
      status: 200,
      headers: {
        location: hostileDriveSession
          ? 'https://evil.example/upload?upload_id=secret'
          : 'https://www.googleapis.com/upload/drive/v3/files?upload_id=fixture',
      },
    });
  if (init?.method === 'PUT') {
    driveFiles.set('drive-fixture', Buffer.from(init.body as Uint8Array));
    return Response.json({ id: 'drive-fixture' });
  }
  if (init?.method === 'DELETE') {
    driveFiles.delete('drive-fixture');
    return new Response(null, { status: 204 });
  }
  if (driveTransportError) throw driveTransportError;
  if (driveDownloadFailure === 'network')
    throw new Error('private transport detail');
  if (driveDownloadFailure)
    return new Response('private Google response', {
      status: driveDownloadFailure,
      headers: { location: 'https://evil.example/private?token=private' },
    });
  const bytes = driveFiles.get('drive-fixture');
  return bytes
    ? new Response(new Uint8Array(bytes))
    : new Response(null, { status: 404 });
};
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
const libraryBase = () => `/api/v1/organizations/${organizationId}/attachments`;
const upload = (
  bytes = pluginFixture(),
  cookie = owner.cookie,
  org = organizationId,
) =>
  app.inject({
    method: 'POST',
    url: `/api/v1/organizations/${org}/attachments/plugin`,
    headers: { origin, cookie, 'content-type': 'application/zip' },
    payload: bytes,
  });
const removeAttachment = (id: string, cookie = owner.cookie) =>
  app.inject({
    method: 'DELETE',
    url: `${libraryBase()}/${id}`,
    headers: { origin, cookie },
  });
const uploadedCommand = (id: string) => ({
  kind: 'plugin',
  action: 'install',
  slug: 'sample',
  attachmentId: id,
});
const packagePoll = () =>
  call(
    'POST',
    '/connector/software-poll',
    { siteId: sites[0], enabled: true, packageSupport: 1 },
    '',
    credential,
  );
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
      BETTER_AUTH_SECRET: authSecret,
      GOOGLE_DRIVE_CLIENT_ID: 'fixture-client',
      GOOGLE_DRIVE_CLIENT_SECRET: 'fixture-secret',
      LOG_LEVEL: 'silent',
    }),
    sendAuthMail: async () => {},
    driveFetch,
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
  driveFiles.clear();
  driveRequests.length = 0;
  hostileDriveSession = false;
  driveDownloadFailure = undefined;
  driveTransportError = undefined;
  await database.db
    .delete(schema.accounts)
    .where(eq(schema.accounts.providerId, 'google'));
  await database.db.delete(schema.sites);
  await database.db.delete(schema.softwareAttachments);
  await database.db
    .update(schema.organizationMembers)
    .set({ role: 'owner' })
    .where(eq(schema.organizationMembers.userId, owner.id));
  await database.db
    .update(schema.organizationMembers)
    .set({ role: 'member' })
    .where(eq(schema.organizationMembers.userId, reader.id));
  await database.db.update(schema.users).set({ emailVerified: true });
  await linkDrive();
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
async function linkDrive(subject = 'google-original') {
  await database.db.insert(schema.accounts).values({
    id: randomUUID(),
    userId: owner.id,
    providerId: 'google',
    accountId: subject,
    accessToken: await symmetricEncrypt({
      key: authSecret,
      data: 'fixture-access',
    }),
    refreshToken: await symmetricEncrypt({
      key: authSecret,
      data: 'fixture-refresh',
    }),
    accessTokenExpiresAt: new Date(Date.now() + 3600_000),
    scope: 'openid email profile https://www.googleapis.com/auth/drive.file',
  });
}
const uploadDrive = (
  bytes = pluginFixture(),
  cookie = owner.cookie,
  kind = 'plugin',
) =>
  app.inject({
    method: 'POST',
    url: `${libraryBase()}/${kind}?storage=google_drive`,
    headers: { origin, cookie, 'content-type': 'application/zip' },
    payload: bytes,
  });
async function driveLease(kind = 'plugin') {
  const bytes =
    kind === 'plugin'
      ? pluginFixture()
      : packageFixture([
          {
            path: 'sample/style.css',
            content: '/*\nTheme Name: Sample\nVersion: 1.0\n*/',
          },
        ]);
  const uploaded = await uploadDrive(bytes, owner.cookie, kind);
  expect(uploaded.statusCode, uploaded.body).toBe(200);
  await packagePoll();
  const response = await preview([sites[0]!], {
    ...uploadedCommand(uploaded.json().id),
    kind,
  });
  expect(response.statusCode, response.body).toBe(200);
  expect((await confirm(response.json().batchId)).statusCode).toBe(200);
  const cmd = (await packagePoll()).json().command;
  const download = () =>
    call(
      'POST',
      '/connector/software-package',
      { siteId: sites[0], operationId: cmd.id, token: cmd.token },
      '',
      credential,
    );
  return { bytes, download, id: uploaded.json().id as string };
}
it.each(['plugin', 'theme'])(
  'installs Drive %s bytes through the existing lease without exposing Drive identifiers',
  async (kind) => {
    const { bytes, download } = await driveLease(kind);
    const result = await download();
    expect(result.statusCode, result.body).toBe(200);
    expect(result.rawPayload.equals(bytes)).toBe(true);
    const [row] = await database.db.select().from(schema.softwareAttachments);
    expect(row).toMatchObject({
      storage: 'google_drive',
      zipBase64: null,
      driveFileId: 'drive-fixture',
      driveAccountId: 'google-original',
    });
    const list = await call(
      'GET',
      `/organizations/${organizationId}/attachments`,
    );
    expect(list.json().attachments[0].storage).toBe('google_drive');
    expect(list.body).not.toMatch(
      /drive-fixture|google-original|fixture-access|fixture-refresh|zipBase64/,
    );
    driveFiles.set('drive-fixture', Buffer.alloc(bytes.length));
    expect((await download()).statusCode).toBe(409);
    driveFiles.set('drive-fixture', Buffer.alloc(bytes.length + 1));
    expect((await download()).statusCode).toBe(409);
    driveFiles.delete('drive-fixture');
    expect((await download()).statusCode).toBe(409);
  },
);
it.each([
  [401, 'HTTP 401'],
  [403, 'HTTP 403'],
  [404, 'HTTP 404'],
  [429, 'HTTP 429'],
  [503, 'unexpected HTTP'],
  [302, 'redirect'],
  ['network', 'outbound HTTPS'],
] as const)(
  'rejects previews before queuing when Drive fails with %s',
  async (failure, message) => {
    const uploaded = await uploadDrive();
    expect(uploaded.statusCode, uploaded.body).toBe(200);
    await packagePoll();
    driveDownloadFailure = failure;
    const requestCount = driveRequests.length;
    const response = await preview(
      [sites[0]!],
      uploadedCommand(uploaded.json().id),
    );
    expect(response.statusCode, response.body).toBe(409);
    expect(response.json().error.message).toContain(message);
    expect(driveRequests).toHaveLength(requestCount + 1);
    expect(response.body).not.toMatch(
      /private|fixture-access|fixture-refresh|google-original|drive-fixture/,
    );
    expect(
      await database.db.select().from(schema.softwareOperations),
    ).toHaveLength(0);
  },
);
it.each([
  [new DOMException('private timeout', 'TimeoutError'), 'timed out'],
  [
    new TypeError('private fetch failure', { cause: { code: 'ENOTFOUND' } }),
    'DNS inside',
  ],
  [
    new TypeError('private fetch failure', {
      cause: { code: 'CERT_HAS_EXPIRED' },
    }),
    'TLS connection',
  ],
  [
    new TypeError('private fetch failure', { cause: { code: 'ECONNRESET' } }),
    'reset or unreachable',
  ],
  [
    new TypeError('private fetch failure', {
      cause: new AggregateError([
        { code: 'ETIMEDOUT' },
        { code: 'UND_ERR_CONNECT_TIMEOUT' },
      ]),
    }),
    'timed out',
  ],
  [
    new TypeError('private fetch failure', {
      cause: new AggregateError([
        { code: 'ETIMEDOUT' },
        { code: 'ENETUNREACH' },
      ]),
    }),
    'outbound HTTPS',
  ],
] as const)(
  'classifies transport failure %s without leaking raw errors',
  async (failure, message) => {
    const uploaded = await uploadDrive();
    expect(uploaded.statusCode, uploaded.body).toBe(200);
    await packagePoll();
    driveTransportError = failure;
    const response = await preview(
      [sites[0]!],
      uploadedCommand(uploaded.json().id),
    );
    expect(response.statusCode, response.body).toBe(409);
    expect(response.json().error.message).toContain(message);
    expect(response.body).not.toMatch(
      /private|fixture-access|fixture-refresh|google-original|drive-fixture/,
    );
    expect(
      await database.db.select().from(schema.softwareOperations),
    ).toHaveLength(0);
  },
);
it('checks Drive bytes during preview and rechecks storage at download time', async () => {
  const { bytes, download, id } = await driveLease();
  driveFiles.set('drive-fixture', Buffer.alloc(bytes.length));
  const changed = await preview([sites[0]!], uploadedCommand(id));
  expect(changed.statusCode).toBe(409);
  expect(changed.json().error.message).toContain(
    'differs from the scanned attachment',
  );
  driveDownloadFailure = 403;
  const rejected = await download();
  expect(rejected.statusCode).toBe(409);
  expect(rejected.headers['x-sitepulse-error-code']).toBe('package_storage');
  expect(rejected.json().error.message).toContain('HTTP 403');
});
it('binds Drive storage to the original account and current owner authority', async () => {
  const { download } = await driveLease();
  expect(
    (
      await app.inject({
        method: 'DELETE',
        url: '/api/v1/me/google-drive',
        headers: { origin, cookie: owner.cookie },
      })
    ).statusCode,
  ).toBe(200);
  expect(driveFiles.size).toBe(1);
  expect((await download()).statusCode).toBe(409);
  // Better Auth refreshes the tokens when the same account is linked again,
  // but may leave the historical scope column empty after an older disconnect.
  await database.db
    .update(schema.accounts)
    .set({
      accessToken: await symmetricEncrypt({
        key: authSecret,
        data: 'fixture-access',
      }),
      refreshToken: await symmetricEncrypt({
        key: authSecret,
        data: 'fixture-refresh',
      }),
      accessTokenExpiresAt: new Date(Date.now() + 3600_000),
      scope: null,
    })
    .where(
      and(
        eq(schema.accounts.userId, owner.id),
        eq(schema.accounts.providerId, 'google'),
      ),
    );
  expect((await download()).statusCode).toBe(200);
  // Clear the restored original credentials before connecting a different
  // account: adding another account must not revoke a still-valid original.
  const disconnected = await app.inject({
    method: 'DELETE',
    url: '/api/v1/me/google-drive',
    headers: { origin, cookie: owner.cookie },
  });
  expect(disconnected.statusCode, disconnected.body).toBe(200);
  expect((await download()).statusCode).toBe(409);
  await linkDrive('other-account');
  expect((await download()).statusCode).toBe(409);
  await database.db
    .delete(schema.accounts)
    .where(eq(schema.accounts.providerId, 'google'));
  await linkDrive();
  expect((await download()).statusCode).toBe(200);
  await database.db
    .update(schema.organizationMembers)
    .set({ role: 'member' })
    .where(eq(schema.organizationMembers.userId, owner.id));
  expect((await download()).statusCode).toBe(403);
});
it('rechecks the Drive owner even when another administrator runs the installation', async () => {
  await database.db
    .update(schema.organizationMembers)
    .set({ role: 'admin' })
    .where(eq(schema.organizationMembers.userId, reader.id));
  const uploaded = await uploadDrive();
  await packagePoll();
  const response = await call(
    'POST',
    `${base()}/preview`,
    {
      siteIds: [sites[0]],
      command: uploadedCommand(uploaded.json().id),
      reason: 'Shared library test',
    },
    reader.cookie,
  );
  expect(response.statusCode, response.body).toBe(200);
  expect(
    (
      await call(
        'POST',
        `${base()}/${response.json().batchId}/confirm`,
        {},
        reader.cookie,
      )
    ).statusCode,
  ).toBe(200);
  const cmd = (await packagePoll()).json().command;
  const download = () =>
    call(
      'POST',
      '/connector/software-package',
      { siteId: sites[0], operationId: cmd.id, token: cmd.token },
      '',
      credential,
    );
  expect((await download()).statusCode).toBe(200);
  await database.db
    .update(schema.organizationMembers)
    .set({ role: 'member' })
    .where(eq(schema.organizationMembers.userId, owner.id));
  expect((await download()).statusCode).toBe(403);
});
it('authorizes Drive uploads before contacting Google and reuses existing fingerprints', async () => {
  await database.db
    .delete(schema.accounts)
    .where(eq(schema.accounts.providerId, 'google'));
  expect((await upload()).statusCode).toBe(409);
  expect(
    await database.db.select().from(schema.softwareAttachments),
  ).toHaveLength(0);
  expect(driveRequests).toHaveLength(0);
  await linkDrive();
  expect((await uploadDrive(pluginFixture(), reader.cookie)).statusCode).toBe(
    403,
  );
  expect((await uploadDrive(pluginFixture(), outsider.cookie)).statusCode).toBe(
    404,
  );
  expect(driveRequests).toHaveLength(0);
  const id = (await upload()).json().id;
  const requests = driveRequests.length;
  expect((await uploadDrive()).json()).toMatchObject({ id, reused: true });
  expect(driveRequests).toHaveLength(requests);
  await removeAttachment(id);
  const uploaded = await uploadDrive();
  expect(uploaded.statusCode).toBe(200);
  expect((await removeAttachment(uploaded.json().id)).statusCode).toBe(200);
  expect(driveFiles.size).toBe(1);
});
it('refuses untrusted resumable upload hosts and leaves no library entry on failure', async () => {
  hostileDriveSession = true;
  expect((await uploadDrive()).statusCode).toBe(409);
  expect(
    await database.db.select().from(schema.softwareAttachments),
  ).toHaveLength(0);
  expect(
    driveRequests.every((url) => url.startsWith('https://www.googleapis.com/')),
  ).toBe(true);
});
it('rejects database storage requests without contacting Google or saving bytes', async () => {
  const response = await app.inject({
    method: 'POST',
    url: `${libraryBase()}/plugin?storage=database`,
    headers: {
      origin,
      cookie: owner.cookie,
      'content-type': 'application/zip',
    },
    payload: pluginFixture(),
  });
  expect(response.statusCode).toBe(400);
  expect(driveRequests).toHaveLength(0);
  expect(
    await database.db.select().from(schema.softwareAttachments),
  ).toHaveLength(0);
});
it('refuses new uploads when Drive is not configured without a database fallback', async () => {
  const unconfigured = await buildApp({
    db: database.db,
    env: parseEnvironment({
      NODE_ENV: 'test',
      DATABASE_URL: process.env.TEST_DATABASE_URL,
      APP_ORIGIN: origin,
      BETTER_AUTH_SECRET: authSecret,
      LOG_LEVEL: 'silent',
    }),
    sendAuthMail: async () => {},
    driveFetch,
  });
  try {
    const response = await unconfigured.inject({
      method: 'POST',
      url: `${libraryBase()}/plugin`,
      headers: {
        origin,
        cookie: owner.cookie,
        'content-type': 'application/zip',
      },
      payload: pluginFixture(),
    });
    expect(response.statusCode, response.body).toBe(409);
    expect(driveRequests).toHaveLength(0);
    expect(
      await database.db.select().from(schema.softwareAttachments),
    ).toHaveLength(0);
  } finally {
    await unconfigured.close();
  }
});
it('keeps legacy database packages installable and deduplicated without Drive access', async () => {
  const { bytes, download, id } = await driveLease();
  // Simulate a package saved before Drive-only uploads were introduced.
  await database.db
    .update(schema.softwareAttachments)
    .set({
      storage: 'database',
      zipBase64: bytes.toString('base64'),
      driveFileId: null,
      driveAccountId: null,
    })
    .where(eq(schema.softwareAttachments.id, id));
  await database.db
    .delete(schema.accounts)
    .where(eq(schema.accounts.providerId, 'google'));
  driveRequests.length = 0;
  expect((await upload()).json()).toEqual({ id, reused: true });
  const response = await download();
  expect(response.statusCode, response.body).toBe(200);
  expect(response.rawPayload.equals(bytes)).toBe(true);
  expect(driveRequests).toHaveLength(0);
  await database.db
    .update(schema.softwareAttachments)
    .set({ zipBase64: Buffer.from('tampered').toString('base64') })
    .where(eq(schema.softwareAttachments.id, id));
  expect((await download()).statusCode).toBe(409);
});
it('protects Google account connection with session, Origin, verification and OAuth state', async () => {
  expect(
    (await call('GET', '/me/google-drive', undefined, '')).statusCode,
  ).toBe(401);
  expect(
    (await call('POST', '/me/google-drive/connect', {}, '')).statusCode,
  ).toBe(401);
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/api/v1/me/google-drive/connect',
        headers: { cookie: owner.cookie },
        payload: {},
      })
    ).statusCode,
  ).toBe(403);
  await database.db
    .update(schema.users)
    .set({ emailVerified: false })
    .where(eq(schema.users.id, owner.id));
  expect((await call('POST', '/me/google-drive/connect', {})).statusCode).toBe(
    403,
  );
  await database.db
    .update(schema.users)
    .set({ emailVerified: true })
    .where(eq(schema.users.id, owner.id));
  const response = await call('POST', '/me/google-drive/connect', {});
  expect(response.statusCode, response.body).toBe(200);
  const url = new URL(response.json().url);
  expect(url.origin).toBe('https://accounts.google.com');
  expect(url.searchParams.get('scope')).toContain(
    'https://www.googleapis.com/auth/drive.file',
  );
  expect(url.searchParams.get('access_type')).toBe('offline');
  expect(url.searchParams.get('state')).toBeTruthy();
  expect(
    response.cookies.some(
      (cookie) => cookie.httpOnly && cookie.sameSite === 'Lax',
    ),
  ).toBe(true);
  const callback = await app.inject({
    method: 'GET',
    url: '/api/v1/auth/callback/google?state=invalid&code=fixture',
  });
  expect(callback.headers.location).toBe('/app/attachments?drive=error');
  expect(callback.body).not.toContain('fixture');
  expect((await call('POST', '/auth/get-access-token', {})).statusCode).toBe(
    404,
  );
});

it('defaults to Drive without storing ZIP bytes, deduplicates and exposes scoped metadata', async () => {
  const response = await upload();
  expect(response.statusCode, response.body).toBe(200);
  const id = response.json().id;
  const [stored] = await database.db.select().from(schema.softwareAttachments);
  expect(stored).toMatchObject({
    storage: 'google_drive',
    zipBase64: null,
    driveFileId: 'drive-fixture',
  });
  expect((await upload()).json()).toEqual({ id, reused: true });
  const list = await call(
    'GET',
    `/organizations/${organizationId}/attachments`,
  );
  expect(list.json().attachments).toHaveLength(1);
  expect(list.json().attachments[0]).toMatchObject({
    id,
    name: 'Sample',
    slug: 'sample',
    scan: { status: 'complete' },
  });
  expect(list.body).not.toContain('zipBase64');
  expect(
    (
      await call(
        'GET',
        `/organizations/${organizationId}/attachments`,
        undefined,
        outsider.cookie,
      )
    ).statusCode,
  ).toBe(404);
  expect((await upload(pluginFixture(), reader.cookie)).statusCode).toBe(403);
  expect(
    (await upload(pluginFixture(), owner.cookie, foreignOrg)).statusCode,
  ).toBe(404);
  expect((await removeAttachment(id, outsider.cookie)).statusCode).toBe(404);
  expect((await removeAttachment(id, reader.cookie)).statusCode).toBe(403);
  expect((await removeAttachment(id)).statusCode).toBe(200);
});
it('stores the inferred ZIP root slug without a client-supplied slug', async () => {
  const bytes = packageFixture([
    {
      path: 'custom-package/main.php',
      content: '<?php\n/*\nPlugin Name: Custom\nVersion: 2.0\n*/',
    },
  ]);
  const response = await upload(bytes);
  expect(response.statusCode, response.body).toBe(200);
  const list = await call(
    'GET',
    `/organizations/${organizationId}/attachments`,
  );
  expect(list.json().attachments[0]).toMatchObject({
    slug: 'custom-package',
    name: 'Custom',
    version: '2.0',
  });
});

it('rejects invalid archives and blocks risky attachments from installation', async () => {
  expect((await upload(Buffer.from('invalid zip'))).statusCode).toBe(400);
  const response = await upload(
    pluginFixture('eval(base64_decode("fixture"));'),
  );
  expect(response.statusCode, response.body).toBe(200);
  await packagePoll();
  expect(
    (await preview([sites[0]!], uploadedCommand(response.json().id)))
      .statusCode,
  ).toBe(409);
  const list = (
    await call('GET', `/organizations/${organizationId}/attachments`)
  ).json();
  expect(list.attachments[0].scan.status).toBe('blocked');
  expect(JSON.stringify(list)).not.toContain('fixture');
});
it('requires current package capability and prevents foreign attachment references', async () => {
  const id = (await upload()).json().id;
  expect((await preview([sites[0]!], uploadedCommand(id))).statusCode).toBe(
    409,
  );
  await packagePoll();
  expect((await preview([sites[0]!], uploadedCommand(id))).statusCode).toBe(
    200,
  );
  await database.db
    .update(schema.softwareAttachments)
    .set({ organizationId: foreignOrg });
  expect((await preview([sites[0]!], uploadedCommand(id))).statusCode).toBe(
    404,
  );
});
it('delivers exact bytes only to a live site-scoped lease and locks pending attachments', async () => {
  const bytes = pluginFixture();
  const id = (await upload(bytes)).json().id;
  await packagePoll();
  const response = await preview([sites[0]!], uploadedCommand(id));
  expect(response.statusCode, response.body).toBe(200);
  const batch = response.json().batchId;
  expect((await removeAttachment(id)).statusCode).toBe(409);
  expect((await confirm(batch)).statusCode).toBe(200);
  const cmd = (await packagePoll()).json().command;
  expect(cmd.packageSha256).toMatch(/^[a-f0-9]{64}$/);
  const payload = { siteId: sites[0], operationId: cmd.id, token: cmd.token };
  const result = await call(
    'POST',
    '/connector/software-package',
    payload,
    '',
    credential,
  );
  expect(result.statusCode, result.body).toBe(200);
  expect(result.rawPayload.equals(bytes)).toBe(true);
  expect(result.headers['cache-control']).toBe('no-store');
  expect(
    (
      await call(
        'POST',
        '/connector/software-package',
        { ...payload, token: randomBytes(32).toString('base64url') },
        '',
        credential,
      )
    ).statusCode,
  ).toBe(404);
  expect(
    (
      await call(
        'POST',
        '/connector/software-package',
        { ...payload, siteId: sites[1] },
        '',
        credential,
      )
    ).statusCode,
  ).toBe(401);
  await database.db
    .update(schema.siteManagement)
    .set({ packageSupport: false })
    .where(eq(schema.siteManagement.siteId, sites[0]!));
  expect(
    (await call('POST', '/connector/software-package', payload, '', credential))
      .statusCode,
  ).toBe(409);
  await database.db
    .update(schema.siteManagement)
    .set({ packageSupport: true })
    .where(eq(schema.siteManagement.siteId, sites[0]!));
  await database.db
    .update(schema.organizationMembers)
    .set({ role: 'member' })
    .where(eq(schema.organizationMembers.userId, owner.id));
  expect(
    (await call('POST', '/connector/software-package', payload, '', credential))
      .statusCode,
  ).toBe(403);
});
it('rejects tampered bytes, old scans and expired package downloads', async () => {
  const id = (await upload()).json().id;
  await packagePoll();
  await database.db
    .update(schema.softwareAttachments)
    .set({
      scan: {
        version: 'sitepulse-static-0',
        status: 'complete',
        scannedFiles: 1,
        findings: [],
      },
    })
    .where(eq(schema.softwareAttachments.id, id));
  expect((await preview([sites[0]!], uploadedCommand(id))).statusCode).toBe(
    409,
  );
  await database.db
    .update(schema.softwareAttachments)
    .set({
      scan: {
        version: 'sitepulse-static-1',
        status: 'complete',
        scannedFiles: 1,
        findings: [],
      },
    })
    .where(eq(schema.softwareAttachments.id, id));
  const batch = (await preview([sites[0]!], uploadedCommand(id))).json()
    .batchId;
  await confirm(batch);
  const cmd = (await packagePoll()).json().command;
  const payload = { siteId: sites[0], operationId: cmd.id, token: cmd.token };
  const [stored] = await database.db
    .select()
    .from(schema.softwareAttachments)
    .where(eq(schema.softwareAttachments.id, id));
  await database.db
    .update(schema.softwareAttachments)
    .set({ byteSize: stored!.byteSize - 1 })
    .where(eq(schema.softwareAttachments.id, id));
  expect(
    (await call('POST', '/connector/software-package', payload, '', credential))
      .statusCode,
  ).toBe(409);
  await database.db
    .update(schema.softwareAttachments)
    .set({ byteSize: stored!.byteSize })
    .where(eq(schema.softwareAttachments.id, id));
  driveFiles.set('drive-fixture', Buffer.from('tampered'));
  expect(
    (await call('POST', '/connector/software-package', payload, '', credential))
      .statusCode,
  ).toBe(409);
  await database.db
    .update(schema.softwareOperations)
    .set({ startedAt: new Date(Date.now() - 3 * 60000) });
  expect(
    (await call('POST', '/connector/software-package', payload, '', credential))
      .statusCode,
  ).toBe(404);
});
it('enforces upload size, storage quota, verified identity and trusted Origin', async () => {
  expect((await upload(Buffer.alloc(8388609))).statusCode).toBe(413);
  expect(
    (
      await app.inject({
        method: 'POST',
        url: `${libraryBase()}/plugin`,
        headers: {
          cookie: owner.cookie,
          origin: 'https://evil.example',
          'content-type': 'application/zip',
        },
        payload: pluginFixture(),
      })
    ).statusCode,
  ).toBe(403);
  await database.db
    .update(schema.users)
    .set({ emailVerified: false })
    .where(eq(schema.users.id, owner.id));
  expect((await upload()).statusCode).toBe(403);
  await database.db
    .update(schema.users)
    .set({ emailVerified: true })
    .where(eq(schema.users.id, owner.id));
  const scan = {
    version: 'sitepulse-static-1',
    status: 'complete' as const,
    scannedFiles: 1,
    findings: [],
  };
  await database.db.insert(schema.softwareAttachments).values(
    Array.from({ length: 8 }, (_, index) => ({
      organizationId,
      actorUserId: owner.id,
      kind: 'plugin' as const,
      slug: 'quota',
      name: 'Quota',
      version: '1',
      sha256: String(index),
      byteSize: 8388608,
      storage: 'database' as const,
      zipBase64: '',
      scan,
    })),
  );
  expect((await upload()).statusCode).toBe(409);
});
it('accepts theme packages with matching headers', async () => {
  const result = await app.inject({
    method: 'POST',
    url: `${libraryBase()}/theme`,
    headers: {
      origin,
      cookie: owner.cookie,
      'content-type': 'application/zip',
    },
    payload: packageFixture([
      {
        path: 'sample/style.css',
        content: '/*\nTheme Name: Sample theme\nVersion: 1.0\n*/',
      },
    ]),
  });
  expect(result.statusCode, result.body).toBe(200);
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
it('retains outstanding operations beyond the recent history window without duplicates or foreign rows', async () => {
  const batchId = await queued();
  const [original] = await database.db.select().from(schema.softwareOperations);
  const template = original!;
  await database.db.insert(schema.softwareOperations).values(
    Array.from({ length: 105 }, () => ({
      ...template,
      id: randomUUID(),
      batchId: randomUUID(),
      status: 'preview' as const,
      createdAt: new Date(Date.now() + 1000),
    })),
  );
  const response = await call(
    'GET',
    `/organizations/${organizationId}/software`,
  );
  expect(response.statusCode).toBe(200);
  const operations = response.json().operations;
  expect(operations).toHaveLength(101);
  expect(
    operations.filter((op: { batchId: string }) => op.batchId === batchId),
  ).toHaveLength(1);
  expect(response.body).not.toContain('token');
  const foreign = await call(
    'GET',
    `/organizations/${foreignOrg}/software`,
    undefined,
    outsider.cookie,
  );
  expect(foreign.json().operations).toEqual([]);
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
