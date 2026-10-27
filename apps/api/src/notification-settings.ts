import { createHash, randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { and, eq, schema, sql, type Database } from '@sitepulse/database';
import {
  confirmNotificationEndpoint,
  createNotificationEndpoint,
  emptyRequest,
  notificationEndpointParams,
  organizationParams,
  updateNotificationEndpoint,
  updateNotificationSettings,
} from '@sitepulse/api-contracts';
import { canManageOrganization } from '@sitepulse/shared';
import type { Environment } from '@sitepulse/config';
import type { SendAuthMail, AuthMail } from './auth-mail';
import { HttpError } from './http-error';

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
type User = { id: string; emailVerified: boolean };
const hash = (token: string) =>
  createHash('sha256').update(token).digest('hex');
const missing = () =>
  new HttpError(404, 'NOT_FOUND', 'Notification configuration not found.');
const view = (row: typeof schema.notificationEndpoints.$inferSelect) => ({
  id: row.id,
  destination: row.destination,
  enabled: row.enabled,
  verifiedAt: row.verifiedAt,
  lastMailAt: row.lastMailAt,
});

export async function registerNotificationRoutes(
  app: FastifyInstance,
  {
    db,
    env,
    requireUser,
    mailer,
  }: {
    db: Database;
    env: Environment;
    requireUser: (request: FastifyRequest) => Promise<User>;
    mailer: SendAuthMail;
  },
) {
  async function scoped<T>(
    request: FastifyRequest,
    manage: boolean,
    run: (
      tx: Transaction,
      organizationId: string,
      user: User,
      role: 'owner' | 'admin' | 'member',
    ) => Promise<T>,
  ) {
    const user = await requireUser(request);
    const { organizationId } = organizationParams.parse(request.params);
    return db.transaction(async (tx) => {
      const [member] = await tx
        .select()
        .from(schema.organizationMembers)
        .where(
          and(
            eq(schema.organizationMembers.organizationId, organizationId),
            eq(schema.organizationMembers.userId, user.id),
          ),
        )
        .for('share');
      if (!member) throw missing();
      if (
        manage &&
        (!user.emailVerified || !canManageOrganization(member.role))
      )
        throw new HttpError(
          403,
          'FORBIDDEN',
          'Verified workspace administrator access is required.',
        );
      // Shared lock order serializes limits, cooldowns and endpoint mutations across API replicas.
      await tx
        .select({ id: schema.organizations.id })
        .from(schema.organizations)
        .where(eq(schema.organizations.id, organizationId))
        .for('no key update');
      return run(tx, organizationId, user, member.role);
    });
  }
  const audit = (
    tx: Transaction,
    request: FastifyRequest,
    organizationId: string,
    userId: string | null,
    action: string,
    metadata: Record<string, unknown>,
  ) =>
    tx.insert(schema.auditLogs).values({
      organizationId,
      actorUserId: userId,
      requestId: request.id,
      action: `notification.${action}`,
      metadata: Object.fromEntries(
        Object.entries(metadata).map(([key, value]) => [
          key,
          typeof value === 'string' ? value : JSON.stringify(value),
        ]),
      ),
    });
  async function budget(tx: Transaction, organizationId: string) {
    await tx
      .insert(schema.notificationSettings)
      .values({ organizationId })
      .onConflictDoNothing();
    const [settings] = await tx
      .select()
      .from(schema.notificationSettings)
      .where(eq(schema.notificationSettings.organizationId, organizationId));
    const fresh = Date.now() - settings!.mailWindowAt.getTime() >= 3600000;
    if (!fresh && settings!.mailCount >= 10)
      throw new HttpError(
        429,
        'RATE_LIMITED',
        'Workspace email limit reached. Try again in one hour.',
      );
    await tx
      .update(schema.notificationSettings)
      .set({
        mailWindowAt: fresh ? new Date() : settings!.mailWindowAt,
        mailCount: fresh ? 1 : settings!.mailCount + 1,
      })
      .where(eq(schema.notificationSettings.organizationId, organizationId));
  }
  async function endpoint(tx: Transaction, organizationId: string, id: string) {
    const [row] = await tx
      .select()
      .from(schema.notificationEndpoints)
      .where(
        and(
          eq(schema.notificationEndpoints.id, id),
          eq(schema.notificationEndpoints.organizationId, organizationId),
          sql`${schema.notificationEndpoints.deletedAt} is null`,
        ),
      )
      .for('update');
    if (!row) throw missing();
    return row;
  }
  async function prepareMail(
    tx: Transaction,
    organizationId: string,
    row: typeof schema.notificationEndpoints.$inferSelect,
    test: boolean,
  ): Promise<AuthMail> {
    if (row.lastMailAt && Date.now() - row.lastMailAt.getTime() < 60000)
      throw new HttpError(
        429,
        'RATE_LIMITED',
        'Wait one minute before sending again.',
      );
    if (test && (!row.verifiedAt || !row.enabled))
      throw new HttpError(
        409,
        'RECIPIENT_NOT_READY',
        'Enable and verify the recipient first.',
      );
    if (!test && row.verifiedAt)
      throw new HttpError(
        409,
        'ALREADY_VERIFIED',
        'This recipient is already verified.',
      );
    await budget(tx, organizationId);
    const token = randomBytes(32).toString('base64url');
    await tx
      .update(schema.notificationEndpoints)
      .set({
        lastMailAt: new Date(),
        ...(!test
          ? {
              tokenHash: hash(token),
              tokenExpiresAt: new Date(Date.now() + 3600000),
            }
          : {}),
      })
      .where(eq(schema.notificationEndpoints.id, row.id));
    return {
      to: row.destination,
      kind: test ? 'notification-test' : 'notification-verify',
      url: test
        ? `${env.APP_ORIGIN}/app/notifications`
        : `${env.APP_ORIGIN}/verify-notification#endpointId=${row.id}&token=${token}`,
    };
  }
  async function send(mail: AuthMail) {
    try {
      await mailer(mail);
    } catch {
      throw new HttpError(
        502,
        'MAIL_DELIVERY_FAILED',
        'Email delivery failed. The recipient was saved; wait one minute and retry.',
      );
    }
  }
  const base = '/api/v1/organizations/:organizationId';
  app.get(`${base}/notification-endpoints`, (request) =>
    scoped(request, false, async (tx, organizationId, user, role) => {
      const [settings] = await tx
        .select()
        .from(schema.notificationSettings)
        .where(eq(schema.notificationSettings.organizationId, organizationId));
      const endpoints = await tx
        .select()
        .from(schema.notificationEndpoints)
        .where(
          and(
            eq(schema.notificationEndpoints.organizationId, organizationId),
            sql`${schema.notificationEndpoints.deletedAt} is null`,
          ),
        )
        .orderBy(schema.notificationEndpoints.createdAt);
      const members = await tx
        .select({ email: schema.users.email })
        .from(schema.organizationMembers)
        .innerJoin(
          schema.users,
          eq(schema.users.id, schema.organizationMembers.userId),
        )
        .where(
          and(
            eq(schema.organizationMembers.organizationId, organizationId),
            eq(schema.users.emailVerified, true),
          ),
        );
      return {
        includeMembers: settings?.includeMembers ?? true,
        canManage: user.emailVerified && canManageOrganization(role),
        memberEmails: members.map((m) => m.email),
        endpoints: endpoints.map(view),
      };
    }),
  );
  app.patch(`${base}/notification-settings`, (request) =>
    scoped(request, true, async (tx, organizationId, user) => {
      const change = updateNotificationSettings.parse(request.body);
      await tx
        .insert(schema.notificationSettings)
        .values({ organizationId, ...change })
        .onConflictDoUpdate({
          target: schema.notificationSettings.organizationId,
          set: change,
        });
      await audit(
        tx,
        request,
        organizationId,
        user.id,
        'settings.updated',
        change,
      );
      return change;
    }),
  );
  app.post(`${base}/notification-endpoints`, async (request, reply) => {
    const mail = await scoped(
      request,
      true,
      async (tx, organizationId, user) => {
        const { destination } = createNotificationEndpoint.parse(request.body);
        const [counts] = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(schema.notificationEndpoints)
          .where(
            and(
              eq(schema.notificationEndpoints.organizationId, organizationId),
              sql`${schema.notificationEndpoints.deletedAt} is null`,
            ),
          );
        if (counts!.count >= 20)
          throw new HttpError(
            409,
            'RECIPIENT_LIMIT',
            'A workspace supports at most 20 recipients.',
          );
        const [row] = await tx
          .insert(schema.notificationEndpoints)
          .values({ organizationId, destination })
          .returning();
        const mail = await prepareMail(tx, organizationId, row!, false);
        await audit(tx, request, organizationId, user.id, 'endpoint.created', {
          endpointId: row!.id,
        });
        return mail;
      },
    );
    await send(mail);
    return reply.code(201).send({ status: 'verification_sent' });
  });
  const item = `${base}/notification-endpoints/:endpointId`;
  for (const method of ['PATCH', 'DELETE'] as const)
    app.route({
      method,
      url: item,
      handler: (request) =>
        scoped(request, true, async (tx, organizationId, user) => {
          const { endpointId } = notificationEndpointParams.parse(
            request.params,
          );
          const before = await endpoint(tx, organizationId, endpointId);
          const change =
            method === 'PATCH'
              ? updateNotificationEndpoint.parse(request.body)
              : (emptyRequest.parse(request.body),
                {
                  enabled: false,
                  deletedAt: new Date(),
                  tokenHash: null,
                  tokenExpiresAt: null,
                });
          await tx
            .update(schema.notificationEndpoints)
            .set(change)
            .where(eq(schema.notificationEndpoints.id, endpointId));
          await audit(
            tx,
            request,
            organizationId,
            user.id,
            method === 'PATCH' ? 'endpoint.updated' : 'endpoint.deleted',
            {
              endpointId,
              before: { enabled: before.enabled },
              after: { enabled: change.enabled },
            },
          );
          return { status: 'saved' };
        }),
    });
  for (const action of ['resend', 'test'] as const)
    app.post(`${item}/${action}`, async (request) => {
      const mail = await scoped(
        request,
        true,
        async (tx, organizationId, user) => {
          emptyRequest.parse(request.body);
          const { endpointId } = notificationEndpointParams.parse(
            request.params,
          );
          const row = await endpoint(tx, organizationId, endpointId);
          const mail = await prepareMail(
            tx,
            organizationId,
            row,
            action === 'test',
          );
          await audit(
            tx,
            request,
            organizationId,
            user.id,
            `endpoint.${action}_requested`,
            { endpointId },
          );
          return mail;
        },
      );
      await send(mail);
      return { status: 'sent' };
    });
  // Possession of this opt-in token verifies a destination only; it never grants a session or membership.
  app.post(
    '/api/v1/notification-endpoints/verify',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (request) => {
      const { endpointId, token } = confirmNotificationEndpoint.parse(
        request.body,
      );
      await db.transaction(async (tx) => {
        const [row] = await tx
          .select()
          .from(schema.notificationEndpoints)
          .where(eq(schema.notificationEndpoints.id, endpointId))
          .for('update');
        if (
          !row ||
          row.deletedAt ||
          !row.tokenHash ||
          row.tokenHash !== hash(token) ||
          !row.tokenExpiresAt ||
          row.tokenExpiresAt.getTime() <= Date.now()
        )
          throw new HttpError(
            400,
            'INVALID_VERIFICATION',
            'The verification link is invalid or expired. Ask the workspace administrator for a new link.',
          );
        await tx
          .update(schema.notificationEndpoints)
          .set({
            verifiedAt: new Date(),
            tokenHash: null,
            tokenExpiresAt: null,
          })
          .where(eq(schema.notificationEndpoints.id, endpointId));
        await audit(
          tx,
          request,
          row.organizationId,
          null,
          'endpoint.verified',
          { endpointId },
        );
      });
      return { status: 'verified' };
    },
  );
}
