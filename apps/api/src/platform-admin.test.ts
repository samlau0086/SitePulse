import Fastify from 'fastify';
import { expect, it, vi } from 'vitest';
import type { Database } from '@sitepulse/database';
import { parseEnvironment } from '@sitepulse/config';
import { HttpError } from './http-error';
import { registerPlatformAdminRoutes } from './platform-admin';

it('guards every platform route before touching the database, even with forged headers and bodies', async () => {
  const id = 'd67deea0-0c5f-4f36-b47b-b57dc3b548c0';
  const transaction = vi.fn();
  const app = Fastify();
  let user: { id: string; emailVerified: boolean } | undefined;
  await registerPlatformAdminRoutes(app, {
    db: { transaction } as unknown as Database,
    env: parseEnvironment({
      DATABASE_URL: 'postgres://unused:unused@localhost/sitepulse_test',
      APP_ORIGIN: 'http://localhost:3000',
      BETTER_AUTH_SECRET: 'a'.repeat(48),
      PLATFORM_ADMIN_USER_IDS: id,
    }),
    requireUser: async () => {
      if (!user) throw new HttpError(401, 'UNAUTHENTICATED', 'Please log in.');
      return user;
    },
  });
  try {
    for (const identity of [
      undefined,
      { id, emailVerified: false },
      { id: 'f67deea0-0c5f-4f36-b47b-b57dc3b548c0', emailVerified: true },
    ]) {
      user = identity;
      for (const method of ['GET', 'POST', 'PATCH'] as const) {
        const suffix =
          method === 'GET'
            ? ''
            : `/${id}/entitlements${method === 'POST' ? '/preview' : ''}`;
        const response = await app.inject({
          method,
          url: `/api/v1/admin/workspaces${suffix}`,
          headers: { 'x-user-id': id, 'x-platform-admin': 'true' },
          ...(method !== 'GET'
            ? { payload: { actorUserId: id, role: 'owner', planCode: 'pro' } }
            : {}),
        });
        expect(response.statusCode, response.body).toBe(identity ? 403 : 401);
      }
    }
    expect(transaction).not.toHaveBeenCalled();
  } finally {
    await app.close();
  }
});
