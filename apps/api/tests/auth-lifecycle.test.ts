import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { createDatabase, eq, schema, sql } from '@sitepulse/database';
import { migrateDatabase } from '@sitepulse/database/migrate';
import { parseEnvironment } from '@sitepulse/config';
import { buildApp } from '../src/app';
import type { AuthMail } from '../src/auth-mail';

const origin = 'http://localhost:3000';
const password = 'original unique passphrase';
const mails: AuthMail[] = [];
let app: Awaited<ReturnType<typeof buildApp>>;
let database: ReturnType<typeof createDatabase>;
let cookie: string;
let failingDelivery = false;
const email = 'recovery@example.com';
const tokenOf = (mail: AuthMail) =>
  new URLSearchParams(new URL(mail.url).hash.slice(1)).get('token')!;
const post = (path: string, payload: object, requestOrigin = origin) =>
  app.inject({
    method: 'POST',
    url: `/api/v1/auth/${path}`,
    headers: { origin: requestOrigin },
    payload,
  });

beforeAll(async () => {
  const connectionString = process.env.TEST_DATABASE_URL;
  if (
    !connectionString ||
    !decodeURIComponent(new URL(connectionString).pathname).endsWith('_test')
  )
    throw new Error('A dedicated _test database is required');
  database = createDatabase(connectionString);
  await migrateDatabase(database.db);
  await database.db.execute(sql`TRUNCATE users CASCADE`);
  app = await buildApp({
    db: database.db,
    env: parseEnvironment({
      NODE_ENV: 'test',
      DATABASE_URL: connectionString,
      APP_ORIGIN: origin,
      BETTER_AUTH_SECRET: randomBytes(48).toString('base64url'),
      LOG_LEVEL: 'silent',
    }),
    sendAuthMail: async (mail) => {
      if (failingDelivery) throw new Error('sensitive provider failure');
      mails.push(mail);
    },
  });
});
afterAll(async () => {
  await app?.close();
  await database?.pool.end();
});

it('sends a verification email on registration without leaking the link to JSON', async () => {
  const response = await post('register', {
    email,
    name: 'Recovery',
    password,
  });
  expect(response.statusCode, response.body).toBe(201);
  cookie = response.cookies
    .map((value) => `${value.name}=${value.value}`)
    .join('; ');
  expect(mails).toHaveLength(1);
  expect(mails[0]).toMatchObject({ to: email, kind: 'verify' });
  expect(new URL(mails[0]!.url).pathname).toBe('/verify-email');
  expect(response.body).not.toContain(tokenOf(mails[0]!));
});

it('rejects forged verification tokens and applies trusted Origin even to link confirmation', async () => {
  expect((await post('email/verify', { token: 'forged' })).statusCode).toBe(
    400,
  );
  expect(
    (
      await post(
        'email/verify',
        { token: tokenOf(mails[0]!) },
        'https://evil.example',
      )
    ).statusCode,
  ).toBe(403);
  const [user] = await database.db
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, email));
  expect(user!.emailVerified).toBe(false);
});

it('rejects expired verification tokens', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.now() + 2 * 60 * 60 * 1000);
  try {
    expect(
      (await post('email/verify', { token: tokenOf(mails[0]!) })).statusCode,
    ).toBe(400);
  } finally {
    vi.useRealTimers();
  }
});

it('confirms an email, records the timestamp, and does not create a new session', async () => {
  const result = await post('email/verify', { token: tokenOf(mails[0]!) });
  expect(result.statusCode, result.body).toBe(200);
  expect(result.cookies).toHaveLength(0);
  const session = await app.inject({
    url: '/api/v1/auth/session',
    headers: { cookie },
  });
  expect(session.json().user.emailVerified).toBe(true);
  const [user] = await database.db
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, email));
  expect(user!.emailVerifiedAt).toBeInstanceOf(Date);
  // Better Auth deliberately makes repeat email confirmation idempotent.
  expect(
    (await post('email/verify', { token: tokenOf(mails[0]!) })).statusCode,
  ).toBe(200);
});

it('returns identical responses for unknown, verified, and unverified resend requests', async () => {
  await post('register', {
    email: 'unverified@example.com',
    name: 'Unverified',
    password,
  });
  const responses = [];
  for (const address of [
    'unknown@example.com',
    email,
    'unverified@example.com',
  ])
    responses.push(await post('email/resend', { email: address }));
  expect(responses.every((r) => r.statusCode === 200)).toBe(true);
  expect(responses.map((r) => r.body)).toEqual([
    responses[0]!.body,
    responses[0]!.body,
    responses[0]!.body,
  ]);
  expect(
    mails.filter((mail) => mail.to === 'unknown@example.com'),
  ).toHaveLength(0);
});

it('requests recovery without exposing whether an account exists or accepting redirect injection', async () => {
  const known = await post('password/forgot', { email });
  const unknown = await post('password/forgot', {
    email: 'absent@example.com',
  });
  expect(known.statusCode).toBe(200);
  expect(unknown.body).toBe(known.body);
  expect(
    (
      await post('password/forgot', {
        email,
        redirectTo: 'https://evil.example',
      })
    ).statusCode,
  ).toBe(400);
  const mail = mails.find((mail) => mail.kind === 'reset')!;
  expect(new URL(mail.url).origin).toBe(origin);
  expect(new URL(mail.url).pathname).toBe('/reset-password');
  expect(new URL(mail.url).search).toBe('');
});

it('rejects expired reset tokens', async () => {
  const token = tokenOf(mails.find((mail) => mail.kind === 'reset')!);
  await database.db
    .update(schema.verifications)
    .set({ expiresAt: new Date(0) })
    .where(eq(schema.verifications.identifier, `reset-password:${token}`));
  expect(
    (
      await post('password/reset', {
        token,
        newPassword: 'replacement unique passphrase',
      })
    ).statusCode,
  ).toBe(400);
});

it('resets only once under concurrent requests and revokes all sessions', async () => {
  await post('password/forgot', { email });
  const token = tokenOf(mails.filter((mail) => mail.kind === 'reset').at(-1)!);
  const results = await Promise.all(
    [1, 2].map(() =>
      post('password/reset', {
        token,
        newPassword: 'replacement unique passphrase',
      }),
    ),
  );
  expect(results.map((r) => r.statusCode).sort()).toEqual([200, 400]);
  expect(
    (await app.inject({ url: '/api/v1/auth/session', headers: { cookie } }))
      .statusCode,
  ).toBe(401);
  expect((await post('login', { email, password })).statusCode).toBe(401);
  expect(
    (await post('login', { email, password: 'replacement unique passphrase' }))
      .statusCode,
  ).toBe(200);
  expect(
    (
      await post('password/reset', {
        token,
        newPassword: 'another unique passphrase',
      })
    ).statusCode,
  ).toBe(400);
});

it('keeps delivery errors generic and records no mail secrets in audit logs', async () => {
  failingDelivery = true;
  expect((await post('password/forgot', { email })).statusCode).toBe(200);
  const audit = JSON.stringify(
    await database.db.select().from(schema.auditLogs),
  );
  expect(audit).toContain('auth.mail.delivery_failed');
  expect(audit).not.toContain(email);
  expect(audit).not.toContain(password);
  for (const mail of mails) expect(audit).not.toContain(tokenOf(mail));
});

it('rate limits email requests and refuses missing Origin', async () => {
  const missing = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/password/forgot',
    payload: { email },
  });
  expect(missing.statusCode).toBe(403);
  const responses = await Promise.all(
    Array.from({ length: 6 }, () => post('email/resend', { email })),
  );
  expect(responses.some((r) => r.statusCode === 429)).toBe(true);
});
