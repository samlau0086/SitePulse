import { randomUUID, randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { and, createDatabase, eq, schema, sql } from '@sitepulse/database';
import { migrateDatabase } from '@sitepulse/database/migrate';
import { parseEnvironment } from '@sitepulse/config';
import { buildApp } from '../src/app';

const origin = 'http://localhost:3000';
const password = 'correct horse battery staple';
let app: FastifyInstance;
let database: ReturnType<typeof createDatabase>;
let alice: { cookie: string; id: string };
let bob: { cookie: string; id: string };
let organizationId: string;

async function register(email: string, name: string) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    headers: { origin },
    payload: { name, email, password },
  });
  expect(response.statusCode, response.body).toBe(201);
  const cookieHeader = response.headers['set-cookie'];
  const cookie = (Array.isArray(cookieHeader) ? cookieHeader : [cookieHeader])
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.split(';')[0])
    .join('; ');
  expect(cookie).toContain('session_token=');
  return { cookie, id: response.json().user.id as string };
}

beforeAll(async () => {
  const connectionString = process.env.TEST_DATABASE_URL;
  if (!connectionString)
    throw new Error(
      'TEST_DATABASE_URL is required; run pnpm test:db:up and set a dedicated _test database URL.',
    );
  const target = new URL(connectionString);
  if (!decodeURIComponent(target.pathname).endsWith('_test'))
    throw new Error(
      'Refusing to reset a database whose name does not end in _test',
    );
  database = createDatabase(connectionString);
  await migrateDatabase(database.db);
  await migrateDatabase(database.db); // Re-running migrations must be a no-op.
  await database.db.execute(
    sql`TRUNCATE audit_logs, organization_members, organizations, auth_sessions, auth_accounts, auth_verifications, users CASCADE`,
  );
  app = await buildApp({
    db: database.db,
    sendAuthMail: async () => {},
    env: parseEnvironment({
      NODE_ENV: 'test',
      DATABASE_URL: connectionString,
      APP_ORIGIN: origin,
      BETTER_AUTH_SECRET: randomBytes(48).toString('base64url'),
      LOG_LEVEL: 'silent',
    }),
  });
  await app.ready();
});
afterAll(async () => {
  await app?.close();
  await database?.pool.end();
});

describe('registration and login', () => {
  it('registers normalized unique users and issues HttpOnly SameSite cookies without exposing tokens', async () => {
    alice = await register('ALICE@example.com', 'Alice');
    bob = await register('bob@example.com', 'Bob');
    const [user] = await database.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, alice.id));
    expect(user?.email).toBe('alice@example.com');
    const [account] = await database.db
      .select()
      .from(schema.accounts)
      .where(eq(schema.accounts.userId, alice.id));
    expect(account?.password).toMatch(/^\$argon2id\$/);
    expect(account?.password).not.toContain(password);
  });
  it('rejects duplicate registration and short passwords', async () => {
    const duplicate = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      headers: { origin },
      payload: { email: 'alice@example.com', name: 'Copy', password },
    });
    expect(duplicate.statusCode).toBe(400);
    const invalid = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      headers: { origin },
      payload: { email: 'weak@example.com', name: 'Weak', password: 'short' },
    });
    expect(invalid.statusCode).toBe(400);
    expect((await database.db.select().from(schema.users)).length).toBe(2);
  });
  it('uses a generic response for wrong passwords and unknown users', async () => {
    for (const email of ['alice@example.com', 'unknown@example.com']) {
      const result = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        headers: { origin },
        payload: { email, password: 'wrong password' },
      });
      expect(result.statusCode).toBe(401);
      expect(result.json().error.code).toBe('AUTHENTICATION_FAILED');
      expect(result.body).not.toContain(email);
    }
  });
  it('logs in and returns a sanitized session', async () => {
    const result = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { origin },
      payload: { email: 'alice@example.com', password },
    });
    expect(result.statusCode, result.body).toBe(200);
    expect(result.body).not.toContain('token');
    const cookies = String(result.headers['set-cookie']);
    expect(cookies).toMatch(/HttpOnly/i);
    expect(cookies).toMatch(/SameSite=Lax/i);
    const session = await app.inject({
      url: '/api/v1/auth/session',
      headers: { cookie: alice.cookie },
    });
    expect(session.statusCode).toBe(200);
    expect(session.json().user.id).toBe(alice.id);
    expect(session.body).not.toContain('token');
    expect(session.body).not.toContain('password');
  });
});

describe('organization authorization', () => {
  it('rejects anonymous requests and forged cookies', async () => {
    for (const headers of [
      {},
      { cookie: 'better-auth.session_token=forged' },
    ]) {
      expect(
        (await app.inject({ url: '/api/v1/organizations', headers }))
          .statusCode,
      ).toBe(401);
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/api/v1/organizations',
            headers: { ...headers, origin },
            payload: { name: 'No', slug: 'nope' },
          })
        ).statusCode,
      ).toBe(401);
    }
  });
  it('creates an organization and owner membership atomically', async () => {
    const result = await app.inject({
      method: 'POST',
      url: '/api/v1/organizations',
      headers: { origin, cookie: alice.cookie },
      payload: { name: 'Alice agency', slug: 'alice-agency' },
    });
    expect(result.statusCode, result.body).toBe(201);
    organizationId = result.json().organization.id;
    expect(result.json().organization.ownerUserId).toBe(alice.id);
    expect(result.json().organization.planCode).toBe('free');
    const members = await database.db
      .select()
      .from(schema.organizationMembers)
      .where(eq(schema.organizationMembers.organizationId, organizationId));
    expect(members).toMatchObject([{ userId: alice.id, role: 'owner' }]);
  });
  it('returns a conflict for duplicate slugs without orphaned memberships', async () => {
    const result = await app.inject({
      method: 'POST',
      url: '/api/v1/organizations',
      headers: { origin, cookie: bob.cookie },
      payload: { name: 'Conflict', slug: 'alice-agency' },
    });
    expect(result.statusCode).toBe(409);
    expect((await database.db.select().from(schema.organizations)).length).toBe(
      1,
    );
    expect(
      (await database.db.select().from(schema.organizationMembers)).length,
    ).toBe(1);
  });
  it('rejects attempts to select another owner or a paid plan', async () => {
    const result = await app.inject({
      method: 'POST',
      url: '/api/v1/organizations',
      headers: { origin, cookie: alice.cookie },
      payload: {
        name: 'Injected',
        slug: 'injected',
        ownerUserId: bob.id,
        planCode: 'agency',
      },
    });
    expect(result.statusCode).toBe(400);
  });
  it('allows owner reads and renaming', async () => {
    expect(
      (
        await app.inject({
          url: `/api/v1/organizations/${organizationId}`,
          headers: { cookie: alice.cookie },
        })
      ).statusCode,
    ).toBe(200);
    const result = await app.inject({
      method: 'PATCH',
      url: `/api/v1/organizations/${organizationId}`,
      headers: { origin, cookie: alice.cookie },
      payload: { name: 'Renamed agency' },
    });
    expect(result.statusCode).toBe(200);
    expect(result.json().organization.name).toBe('Renamed agency');
  });
  it('hides all organization data, mutations, and audit logs across tenants', async () => {
    const own = await app.inject({
      method: 'POST',
      url: '/api/v1/organizations',
      headers: { origin, cookie: bob.cookie },
      payload: { name: 'Bob agency', slug: 'bob-agency' },
    });
    expect(own.statusCode).toBe(201);
    const bobOrganizationId = own.json().organization.id as string;
    const list = await app.inject({
      url: '/api/v1/organizations',
      headers: { cookie: bob.cookie },
    });
    expect(list.json().organizations).toMatchObject([
      { id: bobOrganizationId, role: 'owner' },
    ]);
    const aliceList = await app.inject({
      url: '/api/v1/organizations',
      headers: { cookie: alice.cookie },
    });
    expect(aliceList.json().organizations).toMatchObject([
      { id: organizationId, role: 'owner' },
    ]);
    expect(
      (
        await app.inject({
          url: `/api/v1/organizations/${bobOrganizationId}`,
          headers: { cookie: alice.cookie },
        })
      ).statusCode,
    ).toBe(404);
    for (const suffix of ['', '/audit-logs']) {
      const response = await app.inject({
        url: `/api/v1/organizations/${organizationId}${suffix}`,
        headers: { cookie: bob.cookie },
      });
      expect(response.statusCode).toBe(404);
      expect(response.body).not.toContain('Renamed agency');
    }
    const response = await app.inject({
      method: 'PATCH',
      url: `/api/v1/organizations/${organizationId}`,
      headers: { origin, cookie: bob.cookie },
      payload: { name: 'Stolen' },
    });
    expect(response.statusCode).toBe(404);
    const absent = await app.inject({
      url: `/api/v1/organizations/${randomUUID()}`,
      headers: { cookie: bob.cookie },
    });
    expect(absent.json().error.code).toBe(response.json().error.code);
  });
  it('enforces role permissions and observes membership revocation immediately', async () => {
    await database.db
      .insert(schema.organizationMembers)
      .values({ organizationId, userId: bob.id, role: 'member' });
    expect(
      (
        await app.inject({
          url: `/api/v1/organizations/${organizationId}`,
          headers: { cookie: bob.cookie },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: `/api/v1/organizations/${organizationId}`,
          headers: { origin, cookie: bob.cookie },
          payload: { name: 'No permission' },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          url: `/api/v1/organizations/${organizationId}/audit-logs`,
          headers: { cookie: bob.cookie },
        })
      ).statusCode,
    ).toBe(403);
    await database.db
      .update(schema.organizationMembers)
      .set({ role: 'admin' })
      .where(
        and(
          eq(schema.organizationMembers.userId, bob.id),
          eq(schema.organizationMembers.organizationId, organizationId),
        ),
      );
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: `/api/v1/organizations/${organizationId}`,
          headers: { origin, cookie: bob.cookie },
          payload: { name: 'Admin update' },
        })
      ).statusCode,
    ).toBe(200);
    await database.db
      .delete(schema.organizationMembers)
      .where(
        and(
          eq(schema.organizationMembers.userId, bob.id),
          eq(schema.organizationMembers.organizationId, organizationId),
        ),
      );
    expect(
      (
        await app.inject({
          url: `/api/v1/organizations/${organizationId}`,
          headers: { cookie: bob.cookie },
        })
      ).statusCode,
    ).toBe(404);
  });
  it('returns sanitized, tenant-scoped audit events', async () => {
    const response = await app.inject({
      url: `/api/v1/organizations/${organizationId}/audit-logs`,
      headers: { cookie: alice.cookie },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().auditLogs.length).toBeGreaterThanOrEqual(3);
    expect(
      response
        .json()
        .auditLogs.every(
          (log: { organizationId: string }) =>
            log.organizationId === organizationId,
        ),
    ).toBe(true);
    const allLogs = JSON.stringify(
      await database.db.select().from(schema.auditLogs),
    );
    expect(allLogs).toContain('auth.login.failure');
    expect(allLogs).not.toContain(password);
    expect(allLogs).not.toContain('session_token');
    expect(allLogs).not.toContain('alice@example.com');
  });
});

describe('session and request defenses', () => {
  it('blocks missing, foreign, and null origins on mutations', async () => {
    for (const requestOrigin of [undefined, 'https://evil.example', 'null']) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        headers: requestOrigin ? { origin: requestOrigin } : {},
        payload: { email: 'alice@example.com', password },
      });
      expect(response.statusCode).toBe(403);
      expect(response.json().error.code).toBe('INVALID_ORIGIN');
    }
    const response = await app.inject({
      method: 'PATCH',
      url: `/api/v1/organizations/${organizationId}`,
      headers: { origin: 'https://evil.example', cookie: alice.cookie },
      payload: { name: 'CSRF' },
    });
    expect(response.statusCode).toBe(403);
  });
  it('rejects oversized payloads and malformed UUIDs with safe errors', async () => {
    const tooLarge = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { origin },
      payload: { email: 'a'.repeat(20000), password },
    });
    expect(tooLarge.statusCode).toBe(413);
    const invalid = await app.inject({
      url: '/api/v1/organizations/not-a-uuid',
      headers: { cookie: alice.cookie },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.body).not.toContain('stack');
    expect(invalid.json().error.requestId).toBeTruthy();
  });
  it('sets Secure cookies in production', async () => {
    const production = await buildApp({
      db: database.db,
      env: parseEnvironment({
        NODE_ENV: 'production',
        AUTH_MAIL_TRANSPORT: 'resend',
        RESEND_API_KEY: 'test-only-provider-key-not-used',
        DATABASE_URL: process.env.TEST_DATABASE_URL,
        APP_ORIGIN: 'https://sitepulse.example',
        BETTER_AUTH_SECRET: randomBytes(48).toString('base64url'),
        LOG_LEVEL: 'silent',
      }),
    });
    try {
      const response = await production.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        headers: { origin: 'https://sitepulse.example' },
        payload: { email: 'alice@example.com', password },
      });
      expect(response.statusCode, response.body).toBe(200);
      expect(String(response.headers['set-cookie'])).toMatch(/; Secure/i);
      expect(String(response.headers['set-cookie'])).toContain('__Secure-');
    } finally {
      await production.close();
    }
  });
  it('invalidates expired sessions and logout revokes the database session', async () => {
    await database.db
      .update(schema.sessions)
      .set({ expiresAt: new Date(0) })
      .where(eq(schema.sessions.userId, bob.id));
    expect(
      (
        await app.inject({
          url: '/api/v1/auth/session',
          headers: { cookie: bob.cookie },
        })
      ).statusCode,
    ).toBe(401);
    const result = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { origin, cookie: alice.cookie },
      payload: {},
    });
    expect(result.statusCode).toBe(200);
    expect(
      (
        await app.inject({
          url: '/api/v1/auth/session',
          headers: { cookie: alice.cookie },
        })
      ).statusCode,
    ).toBe(401);
  });
  it('rate limits authentication attempts and ignores spoofed forwarding headers', async () => {
    const responses = [];
    for (let index = 0; index < 12; index++) {
      responses.push(
        await app.inject({
          method: 'POST',
          url: '/api/v1/auth/login',
          headers: { origin, 'x-forwarded-for': `192.0.2.${index}` },
          payload: { email: 'nobody@example.com', password: 'wrong password' },
        }),
      );
    }
    expect(responses.some((result) => result.statusCode === 429)).toBe(true);
    expect(
      responses.find((result) => result.statusCode === 429)?.json().error.code,
    ).toBe('RATE_LIMITED');
  });
  it('publishes OpenAPI documentation', async () => {
    const response = await app.inject('/api/v1/docs/json');
    expect(response.statusCode).toBe(200);
    expect(response.json().paths['/api/v1/auth/register']).toBeTruthy();
    expect(
      response.json().paths['/api/v1/organizations/{organizationId}'],
    ).toBeTruthy();
  });
});
