import type { FastifyInstance, FastifyRequest } from 'fastify';
import { and, eq, schema, type Database } from '@sitepulse/database';
import type { Environment } from '@sitepulse/config';
import { driveCallbackQuery, emptyRequest } from '@sitepulse/api-contracts';
import type { Auth } from './auth';
import { HttpError } from './http-error';
import { PACKAGE_LIMIT } from './package-scanner';

const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const unavailable = () =>
  new HttpError(
    409,
    'DRIVE_UNAVAILABLE',
    'Google Drive is unavailable. Reconnect the original Google account and check the file and its permissions.',
  );
type Attachment = typeof schema.softwareAttachments.$inferSelect;
type User = { id: string; emailVerified: boolean };

export function createDriveStorage(
  db: Database,
  auth: Auth,
  env: Environment,
  transport: typeof fetch = fetch,
) {
  const enabled = !!env.GOOGLE_DRIVE_CLIENT_ID;
  async function account(userId: string, accountId?: string) {
    const [row] = await db
      .select()
      .from(schema.accounts)
      .where(
        and(
          eq(schema.accounts.userId, userId),
          eq(schema.accounts.providerId, 'google'),
          ...(accountId ? [eq(schema.accounts.accountId, accountId)] : []),
        ),
      );
    return row;
  }
  function usable(row: Awaited<ReturnType<typeof account>>) {
    return !!(
      enabled &&
      row?.refreshToken &&
      row.scope?.split(/[ ,]+/).includes(SCOPE)
    );
  }
  async function token(userId: string, accountId: string) {
    const row = await account(userId, accountId);
    if (!row || !usable(row)) throw unavailable();
    try {
      const result = await auth.api.getAccessToken({
        body: { accountId: row.id, userId },
      });
      if (
        !result.accessToken ||
        (result.accessTokenExpiresAt &&
          result.accessTokenExpiresAt <= new Date())
      )
        throw unavailable();
      return result.accessToken;
    } catch {
      throw unavailable();
    }
  }
  async function request(
    url: string,
    accessToken: string,
    init: RequestInit = {},
  ) {
    // Only fixed Google endpoints; never accept a package URL, follow redirects,
    // or send a bearer credential to a host supplied by a browser/Drive file.
    try {
      return await transport(url, {
        ...init,
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
        headers: { ...init.headers, Authorization: `Bearer ${accessToken}` },
      });
    } catch {
      throw unavailable();
    }
  }
  async function bounded(response: Response, limit: number) {
    if (
      !response.ok ||
      Number(response.headers.get('content-length')) > limit
    ) {
      await response.body?.cancel().catch(() => {});
      throw unavailable();
    }
    const reader = response.body?.getReader();
    if (!reader) throw unavailable();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > limit) throw unavailable();
        chunks.push(value);
      }
      return Buffer.concat(chunks);
    } catch {
      throw unavailable();
    } finally {
      await reader.cancel().catch(() => {});
    }
  }
  async function remove(fileId: string, accessToken: string) {
    const response = await request(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`,
      accessToken,
      { method: 'DELETE' },
    );
    await response.body?.cancel();
    if (!response.ok && response.status !== 404) throw unavailable();
  }
  return {
    enabled,
    async status(userId: string) {
      return { enabled, connected: usable(await account(userId)) };
    },
    async upload(userId: string, name: string, bytes: Buffer) {
      const row = await account(userId);
      if (!row || !usable(row)) throw unavailable();
      const accessToken = await token(userId, row.accountId);
      // Preallocate an ID so even a lost create response has a known cleanup target.
      const idsResponse = await request(
        'https://www.googleapis.com/drive/v3/files/generateIds?count=1&space=drive&type=files',
        accessToken,
      );
      let ids: unknown;
      try {
        ids = JSON.parse((await bounded(idsResponse, 16_384)).toString());
      } catch {
        throw unavailable();
      }
      const fileId = (ids as { ids?: unknown[] } | null)?.ids?.[0];
      if (typeof fileId !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(fileId))
        throw unavailable();
      try {
        const session = await request(
          'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id',
          accessToken,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Upload-Content-Type': 'application/zip',
              'X-Upload-Content-Length': String(bytes.length),
            },
            body: JSON.stringify({
              id: fileId,
              name,
              mimeType: 'application/zip',
            }),
          },
        );
        await session.body?.cancel();
        const location = new URL(
          session.headers.get('location') ?? 'https://invalid.local',
        );
        if (
          !session.ok ||
          location.origin !== 'https://www.googleapis.com' ||
          location.pathname !== '/upload/drive/v3/files' ||
          location.username ||
          location.password ||
          location.hash ||
          !location.searchParams.get('upload_id')
        )
          throw unavailable();
        const response = await request(location.href, accessToken, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/zip' },
          body: new Uint8Array(bytes),
        });
        const data = JSON.parse(
          (await bounded(response, 16_384)).toString(),
        ) as { id?: string };
        if (data.id !== fileId) throw unavailable();
        return {
          fileId,
          accountId: row.accountId,
          cleanup: () => remove(fileId, accessToken),
        };
      } catch {
        await remove(fileId, accessToken).catch(() => {});
        throw unavailable();
      }
    },
    async download(row: Attachment) {
      if (!row.driveFileId || !row.driveAccountId) throw unavailable();
      const accessToken = await token(row.actorUserId, row.driveAccountId);
      const response = await request(
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(row.driveFileId)}?alt=media`,
        accessToken,
      );
      return bounded(response, Math.min(row.byteSize, PACKAGE_LIMIT));
    },
  };
}
export type DriveStorage = ReturnType<typeof createDriveStorage>;

export async function registerDriveRoutes(
  app: FastifyInstance,
  {
    db,
    auth,
    env,
    drive,
    requireUser,
  }: {
    db: Database;
    auth: Auth;
    env: Environment;
    drive: DriveStorage;
    requireUser: (request: FastifyRequest) => Promise<User>;
  },
) {
  const json = { type: 'object', properties: {}, additionalProperties: false };
  const headers = (request: FastifyRequest) =>
    new Headers({
      cookie: request.headers.cookie ?? '',
      origin: env.APP_ORIGIN,
      'content-type': 'application/json',
    });
  async function verified(request: FastifyRequest) {
    const user = await requireUser(request);
    if (!user.emailVerified)
      throw new HttpError(
        403,
        'FORBIDDEN',
        'Verify your email before connecting Google Drive.',
      );
    return user;
  }
  app.get('/api/v1/me/google-drive', async (request) =>
    drive.status((await requireUser(request)).id),
  );
  app.post(
    '/api/v1/me/google-drive/connect',
    {
      schema: { body: json },
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      emptyRequest.parse(request.body);
      const user = await verified(request);
      if (!drive.enabled) throw unavailable();
      const response = await auth.api.linkSocialAccount({
        headers: headers(request),
        body: {
          provider: 'google',
          callbackURL: `${env.APP_ORIGIN}/app/attachments`,
          errorCallbackURL: `${env.APP_ORIGIN}/app/attachments?drive=error`,
          disableRedirect: true,
        },
        asResponse: true,
      });
      if (!response.ok) throw unavailable();
      const data = (await response.json()) as { url?: string };
      if (
        !data.url ||
        new URL(data.url).origin !== 'https://accounts.google.com'
      )
        throw unavailable();
      reply.header('set-cookie', response.headers.getSetCookie());
      await db.insert(schema.auditLogs).values({
        actorUserId: user.id,
        action: 'drive.connect.started',
        requestId: request.id,
      });
      return { url: data.url };
    },
  );
  app.delete(
    '/api/v1/me/google-drive',
    { schema: { querystring: json } },
    async (request) => {
      const user = await verified(request);
      // Credentials belong only to this authenticated user; attachment metadata and
      // Drive originals survive so reconnecting the same Google subject restores access.
      const rows = await db
        .select({ id: schema.accounts.id })
        .from(schema.accounts)
        .where(
          and(
            eq(schema.accounts.userId, user.id),
            eq(schema.accounts.providerId, 'google'),
          ),
        );
      try {
        for (const row of rows)
          await auth.api.unlinkAccount({
            headers: headers(request),
            body: { accountId: row.id },
          });
      } catch {
        throw new HttpError(
          409,
          'DRIVE_UNAVAILABLE',
          'Sign in again before disconnecting Google Drive.',
        );
      }
      await db.insert(schema.auditLogs).values({
        actorUserId: user.id,
        action: 'drive.disconnected',
        requestId: request.id,
      });
      return { success: true };
    },
  );
  app.get('/api/v1/auth/callback/google', async (request, reply) => {
    reply.header('referrer-policy', 'no-referrer');
    if (!drive.enabled) throw unavailable();
    // Better Auth validates state, its HttpOnly cookie, PKCE and exact account binding.
    const query = driveCallbackQuery.parse(request.query);
    const url = new URL('/api/v1/auth/callback/google', env.APP_ORIGIN);
    for (const [key, value] of Object.entries(query))
      if (value !== undefined && !['scope', 'authuser', 'prompt'].includes(key))
        url.searchParams.set(key, value);
    const response = await auth.handler(
      new Request(url, { headers: headers(request) }),
    );
    await response.body?.cancel();
    reply.header('set-cookie', response.headers.getSetCookie());
    // Never forward OAuth codes, state or provider error text to the product page.
    const location = response.headers.get('location');
    const success = location === `${env.APP_ORIGIN}/app/attachments`;
    await db.insert(schema.auditLogs).values({
      action: success ? 'drive.connect.completed' : 'drive.connect.failed',
      requestId: request.id,
    });
    return reply.redirect(
      success
        ? '/app/attachments?drive=connected'
        : '/app/attachments?drive=error',
    );
  });
}
