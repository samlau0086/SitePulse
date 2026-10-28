import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createDatabase, schema, sql } from '@sitepulse/database';
import { migrateDatabase } from '@sitepulse/database/migrate';
import { parseEnvironment } from '@sitepulse/config';
import { buildApp } from '../src/app';

const origin = 'http://localhost:3000';
let database: ReturnType<typeof createDatabase>;
let app: Awaited<ReturnType<typeof buildApp>>;
let alice: string;
let bob: string;

async function register(email: string) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    headers: { origin },
    payload: {
      name: 'Test user',
      email,
      password: 'correct horse battery staple',
    },
  });
  expect(response.statusCode, response.body).toBe(201);
  const cookies = response.headers['set-cookie'];
  return (Array.isArray(cookies) ? cookies : [cookies])
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.split(';')[0])
    .join('; ');
}
async function zone(cookie: string) {
  const response = await app.inject({
    method: 'GET',
    url: '/api/v1/auth/session',
    headers: { cookie },
  });
  expect(response.statusCode).toBe(200);
  return response.json().user.timeZone;
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
  alice = await register('alice@example.com');
  bob = await register('bob@example.com');
});
afterAll(async () => {
  await app?.close();
  await database?.pool.end();
});

it('defaults to UTC and persists only the authenticated user preference across sessions', async () => {
  expect(await zone(alice)).toBe('UTC');
  const response = await app.inject({
    method: 'PATCH',
    url: '/api/v1/users/me/preferences',
    headers: { cookie: alice, origin },
    payload: { timeZone: 'America/New_York' },
  });
  expect(response.statusCode, response.body).toBe(200);
  expect(response.json()).toEqual({
    preferences: { timeZone: 'America/New_York' },
  });
  expect(await zone(alice)).toBe('America/New_York');
  expect(await zone(bob)).toBe('UTC');
  const login = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    headers: { origin },
    payload: {
      email: 'alice@example.com',
      password: 'correct horse battery staple',
    },
  });
  expect(login.statusCode).toBe(200);
  const cookies = login.headers['set-cookie'];
  const cookie = (Array.isArray(cookies) ? cookies : [cookies])
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.split(';')[0])
    .join('; ');
  expect(await zone(cookie)).toBe('America/New_York');
});
it('requires authentication and trusted Origin and rejects invalid or identity-bearing bodies', async () => {
  const rows = await database.db
    .select({ id: schema.users.id })
    .from(schema.users);
  for (const [headers, payload, status] of [
    [{ origin }, { timeZone: 'UTC' }, 401],
    [{ cookie: alice }, { timeZone: 'UTC' }, 403],
    [
      { cookie: alice, origin: 'https://untrusted.example' },
      { timeZone: 'UTC' },
      403,
    ],
    [{ cookie: alice, origin }, { timeZone: 'Mars/Olympus' }, 400],
    [{ cookie: alice, origin }, { timeZone: '+08:00' }, 400],
    [{ cookie: alice, origin }, { timeZone: 'UTC', userId: rows[1]!.id }, 400],
    [
      { cookie: alice, origin },
      { timeZone: 'UTC', organizationId: 'other' },
      400,
    ],
  ] as const) {
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/v1/users/me/preferences',
      headers,
      payload,
    });
    expect(response.statusCode, response.body).toBe(status);
  }
  expect(await zone(alice)).toBe('America/New_York');
  expect(await zone(bob)).toBe('UTC');
});
