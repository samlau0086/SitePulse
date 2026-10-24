import { createHash, randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { and, eq, schema, sql, type Database } from '@sitepulse/database';
import {
  connectorHeartbeat,
  connectorInventory,
  connectorPair,
  createSite,
  emptyRequest,
  organizationParams,
  siteParams,
  updateSite,
} from '@sitepulse/api-contracts';
import { canManageOrganization } from '@sitepulse/shared';
import { HttpError } from './http-error';
import {
  normalizeSiteUrl,
  validateSiteUrl,
  type ResolveHost,
} from './site-url';

type User = { id: string; emailVerified: boolean };
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
export const hashCredential = (secret: string) =>
  createHash('sha256').update(secret).digest('hex');
const secret = () => randomBytes(32).toString('base64url');
const absent = () =>
  new HttpError(404, 'SITE_NOT_FOUND', 'The requested site was not found.');
const invalidCredential = () =>
  new HttpError(
    401,
    'INVALID_CREDENTIAL',
    'The connector credential is invalid.',
  );

export async function registerSiteRoutes(
  app: FastifyInstance,
  {
    db,
    requireUser,
    resolveHost,
  }: {
    db: Database;
    requireUser: (request: FastifyRequest) => Promise<User>;
    resolveHost?: ResolveHost;
  },
) {
  const jsonSchema = (input: z.ZodType) => {
    const { $schema, ...result } = z.toJSONSchema(input, { io: 'input' });
    void $schema;
    return result;
  };
  const options = (params: z.ZodType, body?: z.ZodType) => ({
    schema: {
      tags: ['Sites'],
      security: [{ sessionCookie: [] }],
      params: jsonSchema(params),
      ...(body ? { body: jsonSchema(body) } : {}),
    },
  });
  async function membership(
    tx: Transaction,
    user: User,
    organizationId: string,
    manage: boolean,
  ) {
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
    if (!member) throw absent();
    if (manage && !canManageOrganization(member.role))
      throw new HttpError(
        403,
        'FORBIDDEN',
        'Organization administrator access is required.',
      );
    if (manage && !user.emailVerified)
      throw new HttpError(
        403,
        'EMAIL_NOT_VERIFIED',
        'Verify your email before managing sites.',
      );
    return member;
  }
  async function withSite<T>(
    request: FastifyRequest,
    manage: boolean,
    run: (
      tx: Transaction,
      site: typeof schema.sites.$inferSelect,
      user: User,
    ) => Promise<T>,
  ) {
    const user = await requireUser(request);
    const { siteId } = siteParams.parse(request.params);
    return db.transaction(async (tx) => {
      const [identity] = await tx
        .select({ organizationId: schema.sites.organizationId })
        .from(schema.sites)
        .where(eq(schema.sites.id, siteId));
      if (!identity) throw absent();
      await membership(tx, user, identity.organizationId, manage);
      const [site] = await tx
        .select()
        .from(schema.sites)
        .where(
          and(
            eq(schema.sites.id, siteId),
            sql`${schema.sites.deletedAt} is null`,
          ),
        )
        .for(manage ? 'update' : 'share');
      if (!site) throw absent();
      return run(tx, site, user);
    });
  }
  const audit = (
    tx: Transaction,
    site: typeof schema.sites.$inferSelect,
    request: FastifyRequest,
    action: string,
    userId?: string,
  ) =>
    tx.insert(schema.auditLogs).values({
      organizationId: site.organizationId,
      actorUserId: userId,
      action,
      requestId: request.id,
      metadata: { siteId: site.id },
    });
  const revoke = async (tx: Transaction, siteId: string) => {
    await tx
      .update(schema.siteCredentials)
      .set({ revokedAt: new Date() })
      .where(eq(schema.siteCredentials.siteId, siteId));
    await tx
      .delete(schema.pairingChallenges)
      .where(eq(schema.pairingChallenges.siteId, siteId));
  };
  const challenge = async (tx: Transaction, siteId: string) => {
    await tx
      .delete(schema.pairingChallenges)
      .where(eq(schema.pairingChallenges.siteId, siteId));
    const code = secret();
    const expiresAt = new Date(Date.now() + 10 * 60_000);
    await tx
      .insert(schema.pairingChallenges)
      .values({ siteId, challengeHash: hashCredential(code), expiresAt });
    return { challenge: code, expiresAt };
  };
  app.get(
    '/api/v1/organizations/:organizationId/sites',
    options(organizationParams),
    async (request) => {
      const user = await requireUser(request);
      const { organizationId } = organizationParams.parse(request.params);
      return db.transaction(async (tx) => {
        await membership(tx, user, organizationId, false);
        return {
          sites: await tx
            .select()
            .from(schema.sites)
            .where(
              and(
                eq(schema.sites.organizationId, organizationId),
                sql`${schema.sites.deletedAt} is null`,
              ),
            )
            .limit(1000),
        };
      });
    },
  );
  app.post(
    '/api/v1/organizations/:organizationId/sites',
    options(organizationParams, createSite),
    async (request, reply) => {
      const user = await requireUser(request);
      const { organizationId } = organizationParams.parse(request.params);
      const input = createSite.parse(request.body);
      const site = await db.transaction(async (tx) => {
        await membership(tx, user, organizationId, true);
        const normalized = await validateSiteUrl(
          input.canonicalUrl,
          resolveHost,
        );
        const [created] = await tx
          .insert(schema.sites)
          .values({ organizationId, name: input.name, ...normalized })
          .returning();
        if (!created) throw new Error('Insert failed');
        await audit(tx, created, request, 'site.created', user.id);
        return created;
      });
      return reply.code(201).send({ site });
    },
  );
  app.get('/api/v1/sites/:siteId', options(siteParams), (request) =>
    withSite(request, false, async (tx, site) => {
      const [inventory] = await tx
        .select()
        .from(schema.siteInventorySnapshots)
        .where(eq(schema.siteInventorySnapshots.siteId, site.id));
      return { site, inventory: inventory ?? null };
    }),
  );
  app.patch(
    '/api/v1/sites/:siteId',
    options(siteParams, updateSite),
    (request) =>
      withSite(request, true, async (tx, site, user) => {
        const input = updateSite.parse(request.body);
        const [updated] = await tx
          .update(schema.sites)
          .set(input)
          .where(eq(schema.sites.id, site.id))
          .returning();
        await audit(tx, site, request, 'site.updated', user.id);
        return { site: updated };
      }),
  );
  for (const operation of [
    'pairing-challenges',
    'rotate-credential',
    'disconnect',
    'delete',
  ] as const) {
    app.route({
      method: operation === 'delete' ? 'DELETE' : 'POST',
      url: `/api/v1/sites/:siteId${operation === 'delete' ? '' : `/${operation}`}`,
      ...options(siteParams),
      handler: (request) =>
        withSite(request, true, async (tx, site, user) => {
          emptyRequest.parse(request.body ?? {});
          if (operation !== 'pairing-challenges') {
            await revoke(tx, site.id);
            await tx
              .update(schema.sites)
              .set({
                status: 'disconnected',
                ...(operation === 'delete' ? { deletedAt: new Date() } : {}),
              })
              .where(eq(schema.sites.id, site.id));
          }
          await audit(tx, site, request, `site.${operation}`, user.id);
          return operation === 'pairing-challenges' ||
            operation === 'rotate-credential'
            ? challenge(tx, site.id)
            : { success: true };
        }),
    });
  }
  app.post(
    '/api/v1/connector/pair',
    {
      schema: { tags: ['Connector'], body: jsonSchema(connectorPair) },
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    },
    async (request) => {
      const input = connectorPair.parse(request.body);
      const normalized = normalizeSiteUrl(input.canonicalUrl);
      return db.transaction(async (tx) => {
        const [identity] = await tx
          .select({ siteId: schema.pairingChallenges.siteId })
          .from(schema.pairingChallenges)
          .where(
            eq(
              schema.pairingChallenges.challengeHash,
              hashCredential(input.challenge),
            ),
          );
        const invalid = () =>
          new HttpError(
            400,
            'INVALID_CHALLENGE',
            'The pairing challenge is invalid or expired.',
          );
        if (!identity) throw invalid();
        const [site] = await tx
          .select()
          .from(schema.sites)
          .where(eq(schema.sites.id, identity.siteId))
          .for('update');
        const [code] = await tx
          .select()
          .from(schema.pairingChallenges)
          .where(
            eq(
              schema.pairingChallenges.challengeHash,
              hashCredential(input.challenge),
            ),
          )
          .for('update');
        if (
          !site ||
          site.deletedAt ||
          site.canonicalUrl !== normalized.canonicalUrl ||
          !code ||
          code.consumedAt ||
          code.expiresAt.getTime() <= Date.now()
        )
          throw invalid();
        await tx
          .update(schema.pairingChallenges)
          .set({ consumedAt: new Date() })
          .where(eq(schema.pairingChallenges.id, code.id));
        const credential = secret();
        await tx
          .insert(schema.siteCredentials)
          .values({
            siteId: site.id,
            credentialHash: hashCredential(credential),
          })
          .onConflictDoUpdate({
            target: schema.siteCredentials.siteId,
            set: {
              credentialHash: hashCredential(credential),
              secretVersion: sql`${schema.siteCredentials.secretVersion} + 1`,
              lastSequence: 0,
              revokedAt: null,
              lastUsedAt: null,
            },
          });
        await tx
          .update(schema.sites)
          .set({ status: 'pending', lastSeenAt: null, lastSuccessAt: null })
          .where(eq(schema.sites.id, site.id));
        await audit(tx, site, request, 'site.paired');
        return { siteId: site.id, credential, heartbeatIntervalSeconds: 900 };
      });
    },
  );
  for (const operation of ['heartbeat', 'disconnect'] as const) {
    app.post(
      `/api/v1/connector/${operation}`,
      {
        schema: {
          tags: ['Connector'],
          security: [{ siteBearer: [] }],
          body: jsonSchema(
            operation === 'heartbeat' ? connectorHeartbeat : siteParams,
          ),
        },
        config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
      },
      async (request) => {
        const input =
          operation === 'heartbeat'
            ? connectorHeartbeat.parse(request.body)
            : siteParams.parse(request.body);
        const bearer = request.headers.authorization?.match(
          /^Bearer ([A-Za-z0-9_-]{43})$/,
        )?.[1];
        if (!bearer) throw invalidCredential();
        return db.transaction(async (tx) => {
          const [site] = await tx
            .select()
            .from(schema.sites)
            .where(eq(schema.sites.id, input.siteId))
            .for('update');
          const [credential] = await tx
            .select()
            .from(schema.siteCredentials)
            .where(
              and(
                eq(schema.siteCredentials.siteId, input.siteId),
                eq(
                  schema.siteCredentials.credentialHash,
                  hashCredential(bearer),
                ),
              ),
            )
            .for('update');
          if (!site || site.deletedAt || !credential || credential.revokedAt)
            throw invalidCredential();
          if (operation === 'disconnect') {
            await revoke(tx, site.id);
            await tx
              .update(schema.sites)
              .set({ status: 'disconnected' })
              .where(eq(schema.sites.id, site.id));
            await audit(tx, site, request, 'site.connector_disconnected');
          } else {
            const heartbeat = connectorHeartbeat.parse(request.body);
            if (heartbeat.sequence <= credential.lastSequence)
              throw new HttpError(
                409,
                'HEARTBEAT_REPLAY',
                'Heartbeat sequence must increase.',
              );
            await tx
              .update(schema.siteCredentials)
              .set({ lastSequence: heartbeat.sequence, lastUsedAt: sql`now()` })
              .where(eq(schema.siteCredentials.id, credential.id));
            await tx
              .update(schema.sites)
              .set({
                status: 'active',
                lastSeenAt: sql`now()`,
                lastSuccessAt: sql`now()`,
                connectorVersion: heartbeat.connectorVersion,
              })
              .where(eq(schema.sites.id, site.id));
          }
          return { success: true };
        });
      },
    );
  }
  app.post(
    '/api/v1/connector/inventory',
    {
      schema: {
        tags: ['Connector'],
        security: [{ siteBearer: [] }],
        body: jsonSchema(connectorInventory),
      },
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    async (request) => {
      const input = connectorInventory.parse(request.body);
      const bearer = request.headers.authorization?.match(
        /^Bearer ([A-Za-z0-9_-]{43})$/,
      )?.[1];
      if (!bearer) throw invalidCredential();
      return db.transaction(async (tx) => {
        const [site] = await tx
          .select()
          .from(schema.sites)
          .where(eq(schema.sites.id, input.siteId))
          .for('update');
        const [credential] = await tx
          .select()
          .from(schema.siteCredentials)
          .where(
            and(
              eq(schema.siteCredentials.siteId, input.siteId),
              eq(schema.siteCredentials.credentialHash, hashCredential(bearer)),
            ),
          )
          .for('update');
        if (!site || site.deletedAt || !credential || credential.revokedAt)
          throw invalidCredential();
        const [inventory] = await tx
          .insert(schema.siteInventorySnapshots)
          .values({
            siteId: site.id,
            wordpressVersion: input.wordpressVersion,
            phpVersion: input.phpVersion,
            activePlugins: input.activePlugins,
            activeThemes: input.activeThemes,
            updateCounts: input.updateCounts,
          })
          .onConflictDoUpdate({
            target: schema.siteInventorySnapshots.siteId,
            set: {
              wordpressVersion: input.wordpressVersion,
              phpVersion: input.phpVersion,
              activePlugins: input.activePlugins,
              activeThemes: input.activeThemes,
              updateCounts: input.updateCounts,
              receivedAt: sql`now()`,
              updatedAt: sql`now()`,
            },
          })
          .returning();
        await tx
          .update(schema.siteCredentials)
          .set({ lastUsedAt: sql`now()` })
          .where(eq(schema.siteCredentials.id, credential.id));
        return {
          success: true,
          receivedAt: inventory?.receivedAt.toISOString(),
        };
      });
    },
  );
}
