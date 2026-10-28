import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { createDatabase, eq, schema, sql } from '@sitepulse/database';
import { migrateDatabase } from '@sitepulse/database/migrate';
import { workspaceEmailBrand } from '@sitepulse/database/branding';
import { parseEnvironment } from '@sitepulse/config';
import { buildApp } from '../src/app';
import { createAuthMailer } from '../src/auth-mail';

const origin = 'http://localhost:3000';
let database: ReturnType<typeof createDatabase>;
let app: Awaited<ReturnType<typeof buildApp>>;
let env: ReturnType<typeof parseEnvironment>;
type Identity = { id: string; cookie: string };
let owner: Identity, other: Identity, operator: Identity, unverified: Identity;
let agency: string, free: string;
const platform = {
  name: 'Platform',
  logoUrl: 'https://cdn.example.com/platform.png',
};
const custom = {
  name: 'Studio',
  logoUrl: 'https://cdn.example.com/studio.png',
};
const call = (
  method: 'GET' | 'PATCH',
  url: string,
  identity: Identity,
  payload?: object,
  requestOrigin = origin,
) =>
  app.inject({
    method,
    url: `/api/v1${url}`,
    headers: { cookie: identity.cookie, origin: requestOrigin },
    ...(payload ? { payload } : {}),
  });
beforeAll(async () => {
  const url = process.env.TEST_DATABASE_URL;
  if (!url || !decodeURIComponent(new URL(url).pathname).endsWith('_test'))
    throw new Error('Dedicated _test database required');
  database = createDatabase(url);
  await migrateDatabase(database.db);
  await database.db.execute(sql`TRUNCATE users CASCADE`);
  await database.db.delete(schema.platformBranding);
  env = parseEnvironment({
    NODE_ENV: 'test',
    DATABASE_URL: url,
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
        password: 'branding test passphrase',
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
        .set({ emailVerified: true })
        .where(eq(schema.users.id, identity.id));
    return identity;
  }
  owner = await register('owner');
  other = await register('other');
  operator = await register('operator');
  unverified = await register('unverified', false);
  await app.close();
  env = { ...env, PLATFORM_ADMIN_USER_IDS: [operator.id, unverified.id] };
  app = await buildApp({ db: database.db, env, sendAuthMail: async () => {} });
  async function workspace(planCode: string) {
    const [row] = await database.db
      .insert(schema.organizations)
      .values({
        name: planCode,
        slug: randomUUID(),
        ownerUserId: owner.id,
        planCode,
      })
      .returning();
    await database.db.insert(schema.organizationMembers).values([
      { organizationId: row!.id, userId: owner.id, role: 'owner' },
      { organizationId: row!.id, userId: other.id, role: 'admin' },
    ]);
    return row!.id;
  }
  agency = await workspace('agency');
  free = await workspace('free');
});
afterAll(async () => {
  vi.unstubAllGlobals();
  await database?.db.delete(schema.platformBranding);
  await app?.close();
  await database?.pool.end();
});

it('protects both branding endpoints with sessions, verified server authority, Origin and strict contracts', async () => {
  for (const identity of [owner, other, unverified, { id: '', cookie: '' }]) {
    for (const method of ['GET', 'PATCH'] as const)
      expect(
        (
          await call(
            method,
            '/admin/branding',
            identity,
            method === 'PATCH' ? platform : undefined,
          )
        ).statusCode,
      ).toBe(identity.cookie ? 403 : 401);
  }
  expect(
    (await call('GET', '/users/me/email-branding', { id: '', cookie: '' }))
      .statusCode,
  ).toBe(401);
  expect(
    (await call('PATCH', '/users/me/email-branding', other, custom)).statusCode,
  ).toBe(403);
  for (const path of ['/admin/branding', '/users/me/email-branding']) {
    const identity = path.startsWith('/admin') ? operator : owner;
    expect(
      (await call('PATCH', path, identity, custom, 'https://evil.example.com'))
        .statusCode,
    ).toBe(403);
    for (const payload of [
      { ...custom, userId: other.id },
      { ...custom, planCode: 'agency' },
      { ...custom, logoUrl: 'javascript:alert(1)' },
      { ...custom, name: 'Injected\r\nHeader' },
    ])
      expect((await call('PATCH', path, identity, payload)).statusCode).toBe(
        400,
      );
  }
});
it('saves platform branding and isolates owner branding; rechecks each workspace tier and downgrade', async () => {
  expect(
    (await call('PATCH', '/admin/branding', operator, platform)).statusCode,
  ).toBe(200);
  expect(await workspaceEmailBrand(database.db, agency)).toEqual(platform);
  expect(
    (await call('PATCH', '/users/me/email-branding', owner, custom)).statusCode,
  ).toBe(200);
  expect(
    (await call('GET', '/users/me/email-branding', other)).json().brand.logoUrl,
  ).toBeNull();
  expect(await workspaceEmailBrand(database.db, agency)).toEqual(custom);
  expect(await workspaceEmailBrand(database.db, free)).toEqual(platform);
  await database.db
    .update(schema.organizations)
    .set({ planCode: 'pro' })
    .where(eq(schema.organizations.id, agency));
  expect(await workspaceEmailBrand(database.db, agency)).toEqual(platform);
  expect(
    (await call('PATCH', '/users/me/email-branding', owner, custom)).statusCode,
  ).toBe(403);
  await database.db
    .update(schema.organizations)
    .set({ planCode: 'agency_plus' })
    .where(eq(schema.organizations.id, agency));
  expect(await workspaceEmailBrand(database.db, agency)).toEqual(custom);
  expect(
    (
      await call('PATCH', '/users/me/email-branding', owner, {
        ...custom,
        logoUrl: null,
      })
    ).statusCode,
  ).toBe(200);
  expect(await workspaceEmailBrand(database.db, agency)).toEqual(platform);
  await call('PATCH', '/users/me/email-branding', owner, custom);
});
it('sends HTML and plain text through the provider with platform auth and owner notification branding', async () => {
  const sent: Array<Record<string, string>> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit) => {
      sent.push(JSON.parse(init.body as string));
      return new Response('{}', { status: 200 });
    }),
  );
  try {
    const mailer = createAuthMailer(
      { ...env, AUTH_MAIL_TRANSPORT: 'resend', RESEND_API_KEY: 'test-only' },
      database.db,
    );
    for (const kind of [
      'reset',
      'verify',
      'notification-verify',
      'notification-test',
    ] as const)
      await mailer({
        to: 'recipient@example.com',
        kind,
        url: `${origin}/verify-email#token=test-only`,
        organizationId: agency,
      });
    for (const [index, mail] of sent.entries()) {
      expect(mail.html).toContain(
        index < 2 ? platform.logoUrl : custom.logoUrl,
      );
      expect(mail.text).toContain('#token=test-only');
      expect(mail.html).toContain('#token=test-only');
      expect(mail.subject).toContain(index < 2 ? platform.name : custom.name);
    }
  } finally {
    vi.unstubAllGlobals();
  }
});
