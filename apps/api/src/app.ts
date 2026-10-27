import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyRequest } from 'fastify';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import { z } from 'zod';
import type { Environment } from '@sitepulse/config';
import { and, desc, eq, schema, sql, type Database } from '@sitepulse/database';
import {
  createOrganization,
  login,
  organizationParams,
  registration,
  requestAuthEmail,
  resetPassword,
  verifyEmail,
  updateOrganization,
} from '@sitepulse/api-contracts';
import { canManageOrganization } from '@sitepulse/shared';
import { createAuth } from './auth';
import { createAuthMailer, type SendAuthMail } from './auth-mail';
import { HttpError } from './http-error';
import { registerSiteRoutes } from './sites';
import { registerNotificationRoutes } from './notification-settings';
import { isPlatformAdmin, registerPlatformAdminRoutes } from './platform-admin';
import type { ResolveHost } from './site-url';

function postgresCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  if ('code' in error && typeof error.code === 'string') return error.code;
  return 'cause' in error ? postgresCode(error.cause) : undefined;
}

export async function buildApp({
  db,
  env,
  sendAuthMail,
  resolveHost,
}: {
  db: Database;
  env: Environment;
  sendAuthMail?: SendAuthMail;
  resolveHost?: ResolveHost;
}) {
  const app = Fastify({
    bodyLimit: 16 * 1024,
    trustProxy: false,
    ajv: {
      customOptions: {
        removeAdditional: false,
        coerceTypes: false,
        useDefaults: false,
      },
    },
    genReqId: () => randomUUID(),
    disableRequestLogging: true,
    logger: {
      level: env.LOG_LEVEL,
      redact: [
        'req.headers.authorization',
        'req.headers.cookie',
        'res.headers.set-cookie',
        'password',
        'token',
        'secret',
      ],
    },
  });
  const mailer = sendAuthMail ?? createAuthMailer(env);
  const auth = createAuth(db, env, async (mail) => {
    try {
      await mailer(mail);
    } catch {
      app.log.error(
        { event: 'auth.mail.delivery_failed' },
        'Authentication email delivery failed',
      );
      await db.insert(schema.auditLogs).values({
        action: 'auth.mail.delivery_failed',
        requestId: randomUUID(),
      });
    }
  });
  await app.register(helmet);
  await app.register(rateLimit, { global: false });
  await app.register(swagger, {
    openapi: {
      info: { title: 'SitePulse API', version: '0.1.0' },
      servers: [{ url: env.APP_ORIGIN }],
      components: {
        securitySchemes: {
          siteBearer: { type: 'http', scheme: 'bearer' },
          sessionCookie: {
            type: 'apiKey',
            in: 'cookie',
            name:
              env.NODE_ENV === 'production'
                ? '__Secure-better-auth.session_token'
                : 'better-auth.session_token',
          },
        },
      },
    },
  });
  app.get('/api/v1/docs/json', { schema: { hide: true } }, async () =>
    app.swagger(),
  );
  app.get(
    '/api/v1/docs/',
    { schema: { hide: true } },
    async (_request, reply) =>
      reply
        .type('text/html')
        .send(
          '<!doctype html><html lang="en"><meta charset="utf-8"><title>SitePulse API</title><h1>SitePulse API</h1><p>Authentication, organizations, isolated sites, pairing, and heartbeats.</p><p><a href="/api/v1/docs/json">OpenAPI JSON reference</a></p><p>See docs/API.md in the repository for request examples and security requirements.</p></html>',
        ),
  );

  app.addHook('onRequest', async (request, reply) => {
    reply.header('x-request-id', request.id);
    reply.header('cache-control', 'no-store');
    if (
      ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method) &&
      request.headers.origin !== env.APP_ORIGIN
    ) {
      throw new HttpError(
        403,
        'INVALID_ORIGIN',
        'A trusted Origin header is required.',
      );
    }
  });
  app.setErrorHandler((error, request, reply) => {
    const failure = error as { statusCode?: number; validation?: unknown };
    if (error instanceof HttpError) {
      return reply.code(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
          requestId: request.id,
        },
      });
    }
    if (
      error instanceof z.ZodError ||
      failure.validation ||
      failure.statusCode === 400 ||
      failure.statusCode === 415
    ) {
      return reply.code(400).send({
        error: {
          code: 'INVALID_REQUEST',
          message: 'The request is invalid.',
          requestId: request.id,
        },
      });
    }
    if (failure.statusCode === 429) {
      return reply.code(429).send({
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many requests. Try again later.',
          requestId: request.id,
        },
      });
    }
    if (failure.statusCode === 413) {
      return reply.code(413).send({
        error: {
          code: 'PAYLOAD_TOO_LARGE',
          message: 'Request body exceeds the size limit.',
          requestId: request.id,
        },
      });
    }
    if (postgresCode(error) === '23505') {
      return reply.code(409).send({
        error: {
          code: 'CONFLICT',
          message: 'The requested resource already exists.',
          requestId: request.id,
        },
      });
    }
    // Do not serialize error objects: database errors may contain SQL and parameter values.
    request.log.error({ requestId: request.id }, 'Request failed');
    return reply.code(500).send({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred.',
        requestId: request.id,
      },
    });
  });
  app.setNotFoundHandler((request, reply) =>
    reply.code(404).send({
      error: {
        code: 'NOT_FOUND',
        message: 'The requested resource was not found.',
        requestId: request.id,
      },
    }),
  );

  function authHeaders(request: FastifyRequest) {
    const headers = new Headers();
    if (request.headers.cookie) headers.set('cookie', request.headers.cookie);
    if (request.headers.origin) headers.set('origin', request.headers.origin);
    headers.set('content-type', 'application/json');
    return headers;
  }
  async function requireUser(request: FastifyRequest) {
    const session = await auth.api.getSession({
      headers: authHeaders(request),
    });
    if (!session) throw new HttpError(401, 'UNAUTHENTICATED', 'Please log in.');
    return session.user;
  }
  const security = [{ sessionCookie: [] }];
  await registerNotificationRoutes(app, { db, env, requireUser, mailer });
  const jsonSchema = (value: z.ZodType) => {
    const { $schema: _schema, ...result } = z.toJSONSchema(value, {
      io: 'input',
      unrepresentable: 'any',
    });
    void _schema;
    return result;
  };
  app.get(
    '/api/v1/health',
    { schema: { summary: 'Readiness check' } },
    async () => {
      await db.execute(sql`select 1`);
      return { status: 'ok' };
    },
  );
  const authRoutes = [
    {
      path: 'register',
      target: 'sign-up/email',
      input: registration,
      event: 'auth.register',
    },
    {
      path: 'login',
      target: 'sign-in/email',
      input: login,
      event: 'auth.login',
    },
    {
      path: 'logout',
      target: 'sign-out',
      input: z.object({}).strict(),
      event: 'auth.logout',
    },
  ] as const;
  for (const route of authRoutes) {
    app.post(
      `/api/v1/auth/${route.path}`,
      {
        schema: {
          summary: route.event,
          body: jsonSchema(route.input),
          tags: ['Authentication'],
        },
        config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      },
      async (request, reply) => {
        const body = route.input.parse(request.body);
        const user =
          route.path === 'logout' ? await requireUser(request) : null;
        const response = await auth.handler(
          new Request(`${env.APP_ORIGIN}/api/v1/auth/${route.target}`, {
            method: 'POST',
            headers: authHeaders(request),
            body: JSON.stringify(body),
          }),
        );
        const data = (await response.json()) as {
          user?: { id: string; email: string; name: string };
        };
        await db.insert(schema.auditLogs).values({
          action: `${route.event}.${response.ok ? 'success' : 'failure'}`,
          actorUserId: response.ok ? (data.user?.id ?? user?.id ?? null) : null,
          requestId: request.id,
        });
        if (!response.ok) {
          // Login failures do not reveal whether the email exists. Registration conflicts are also generic.
          throw new HttpError(
            route.path === 'login' ? 401 : 400,
            'AUTHENTICATION_FAILED',
            'Authentication failed. Check your details and try again.',
          );
        }
        const cookies = response.headers.getSetCookie();
        if (cookies.length) reply.header('set-cookie', cookies);
        // Never send Better Auth's raw session token to browser JavaScript.
        return reply.code(route.path === 'register' ? 201 : 200).send({
          user: data.user
            ? {
                id: data.user.id,
                email: data.user.email,
                name: data.user.name,
              }
            : null,
          success: true,
        });
      },
    );
  }
  const lifecycleRoutes = [
    {
      path: 'password/forgot',
      target: 'request-password-reset',
      input: requestAuthEmail,
    },
    { path: 'password/reset', target: 'reset-password', input: resetPassword },
    {
      path: 'email/resend',
      target: 'send-verification-email',
      input: requestAuthEmail,
    },
    { path: 'email/verify', target: 'verify-email', input: verifyEmail },
  ] as const;
  for (const route of lifecycleRoutes) {
    app.post(
      `/api/v1/auth/${route.path}`,
      {
        schema: {
          summary: route.path,
          body: jsonSchema(route.input),
          tags: ['Authentication'],
        },
        config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
      },
      async (request) => {
        const input = route.input.parse(request.body);
        const verifying = route.path === 'email/verify';
        const sending =
          route.path === 'password/forgot' || route.path === 'email/resend';
        const url = new URL(`/api/v1/auth/${route.target}`, env.APP_ORIGIN);
        if (verifying && 'token' in input)
          url.searchParams.set('token', input.token);
        // Do not forward browser cookies to public email requests: responses stay generic.
        const headers = new Headers({
          origin: env.APP_ORIGIN,
          'content-type': 'application/json',
        });
        const response = await auth.handler(
          new Request(url, {
            method: verifying ? 'GET' : 'POST',
            headers,
            ...(verifying ? {} : { body: JSON.stringify(input) }),
          }),
        );
        await response.body?.cancel();
        await db.insert(schema.auditLogs).values({
          action: `auth.${route.path.replace('/', '.')}.${response.ok ? 'success' : 'failure'}`,
          requestId: request.id,
        });
        if (!sending && !response.ok)
          throw new HttpError(
            400,
            'INVALID_AUTH_LINK',
            'This link is invalid or expired. Request a new email.',
          );
        return sending
          ? {
              success: true,
              message:
                'If this address is eligible, an email will arrive shortly.',
            }
          : { success: true };
      },
    );
  }
  app.get(
    '/api/v1/auth/session',
    { schema: { summary: 'Current user', security } },
    async (request) => {
      const user = await requireUser(request);
      return {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          emailVerified: user.emailVerified,
          isPlatformAdmin: isPlatformAdmin(user, env),
        },
      };
    },
  );
  app.get(
    '/api/v1/organizations',
    { schema: { summary: 'List your organizations', security } },
    async (request) => {
      const user = await requireUser(request);
      const rows = await db
        .select({
          id: schema.organizations.id,
          name: schema.organizations.name,
          slug: schema.organizations.slug,
          role: schema.organizationMembers.role,
        })
        .from(schema.organizations)
        .innerJoin(
          schema.organizationMembers,
          eq(
            schema.organizations.id,
            schema.organizationMembers.organizationId,
          ),
        )
        .where(eq(schema.organizationMembers.userId, user.id));
      return { organizations: rows };
    },
  );
  app.post(
    '/api/v1/organizations',
    {
      schema: {
        summary: 'Create an organization with owner membership',
        security,
        body: jsonSchema(createOrganization),
      },
    },
    async (request, reply) => {
      const user = await requireUser(request);
      const input = createOrganization.parse(request.body);
      const organization = await db.transaction(async (tx) => {
        const [created] = await tx
          .insert(schema.organizations)
          .values({ ...input, ownerUserId: user.id })
          .returning();
        if (!created) throw new Error('Organization insert failed');
        await tx.insert(schema.organizationMembers).values({
          organizationId: created.id,
          userId: user.id,
          role: 'owner',
        });
        await tx.insert(schema.auditLogs).values({
          organizationId: created.id,
          actorUserId: user.id,
          action: 'organization.created',
          requestId: request.id,
        });
        return created;
      });
      return reply
        .code(201)
        .send({ organization: { ...organization, role: 'owner' } });
    },
  );

  // The tenant predicate lives in the query; a guessed UUID never grants access.
  async function memberOrganization(request: FastifyRequest) {
    const user = await requireUser(request);
    const { organizationId } = organizationParams.parse(request.params);
    const [membership] = await db
      .select({
        organization: schema.organizations,
        role: schema.organizationMembers.role,
      })
      .from(schema.organizations)
      .innerJoin(
        schema.organizationMembers,
        eq(schema.organizations.id, schema.organizationMembers.organizationId),
      )
      .where(
        and(
          eq(schema.organizations.id, organizationId),
          eq(schema.organizationMembers.userId, user.id),
        ),
      );
    if (!membership)
      throw new HttpError(
        404,
        'ORGANIZATION_NOT_FOUND',
        'The requested organization was not found.',
      );
    return { user, organizationId, ...membership };
  }
  app.get(
    '/api/v1/organizations/:organizationId',
    {
      schema: {
        summary: 'Read an organization as a member',
        security,
        params: jsonSchema(organizationParams),
      },
    },
    async (request) => {
      const { organization, role } = await memberOrganization(request);
      return { organization: { ...organization, role } };
    },
  );
  app.patch(
    '/api/v1/organizations/:organizationId',
    {
      schema: {
        summary: 'Rename an organization as owner or admin',
        security,
        params: jsonSchema(organizationParams),
        body: jsonSchema(updateOrganization),
      },
    },
    async (request) => {
      const user = await requireUser(request);
      const { organizationId } = organizationParams.parse(request.params);
      const input = updateOrganization.parse(request.body);
      const organization = await db.transaction(async (tx) => {
        // Serialize against membership removal/role changes during the write.
        const [membership] = await tx
          .select()
          .from(schema.organizationMembers)
          .where(
            and(
              eq(schema.organizationMembers.organizationId, organizationId),
              eq(schema.organizationMembers.userId, user.id),
            ),
          )
          .for('update');
        if (!membership)
          throw new HttpError(
            404,
            'ORGANIZATION_NOT_FOUND',
            'The requested organization was not found.',
          );
        if (!canManageOrganization(membership.role))
          throw new HttpError(
            403,
            'FORBIDDEN',
            'Organization administrator access is required.',
          );
        const [updated] = await tx
          .update(schema.organizations)
          .set(input)
          .where(eq(schema.organizations.id, organizationId))
          .returning();
        await tx.insert(schema.auditLogs).values({
          organizationId,
          actorUserId: user.id,
          action: 'organization.updated',
          requestId: request.id,
        });
        return updated;
      });
      return { organization };
    },
  );
  app.get(
    '/api/v1/organizations/:organizationId/audit-logs',
    {
      schema: {
        summary: 'Latest 100 organization audit events (owner/admin)',
        security,
        params: jsonSchema(organizationParams),
      },
    },
    async (request) => {
      const { organizationId, role } = await memberOrganization(request);
      if (!canManageOrganization(role))
        throw new HttpError(
          403,
          'FORBIDDEN',
          'Organization administrator access is required.',
        );
      const logs = await db
        .select()
        .from(schema.auditLogs)
        .where(eq(schema.auditLogs.organizationId, organizationId))
        .orderBy(desc(schema.auditLogs.createdAt))
        .limit(100);
      return { auditLogs: logs };
    },
  );
  await registerSiteRoutes(app, { db, requireUser, resolveHost });
  await registerPlatformAdminRoutes(app, { db, env, requireUser });
  return app;
}
