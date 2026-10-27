import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  adminWorkspaceSearch,
  adminEntitlementPreview,
  adminEntitlementSave,
  organizationParams,
} from '@sitepulse/api-contracts';
import { planSiteLimits, type Environment } from '@sitepulse/config';
import { eq, schema, sql, type Database } from '@sitepulse/database';
import { changeEntitlements, organizationUsage } from './entitlements';
import { HttpError } from './http-error';

type User = { id: string; emailVerified: boolean };
export function isPlatformAdmin(user: User, env: Environment) {
  return user.emailVerified && env.PLATFORM_ADMIN_USER_IDS.includes(user.id);
}

export async function registerPlatformAdminRoutes(
  app: FastifyInstance,
  {
    db,
    env,
    requireUser,
  }: {
    db: Database;
    env: Environment;
    requireUser: (request: FastifyRequest) => Promise<User>;
  },
) {
  // This scope grants entitlement administration only. Tenant APIs still require membership.
  await app.register(
    async (admin) => {
      admin.addHook('preValidation', async (request) => {
        if (!isPlatformAdmin(await requireUser(request), env))
          throw new HttpError(
            403,
            'PLATFORM_ADMIN_REQUIRED',
            'Platform administrator access is required.',
          );
      });
      admin.get('/workspaces', async (request) => {
        const { q, page } = adminWorkspaceSearch.parse(request.query);
        return db.transaction(async (tx) => {
          const rows = await tx
            .select()
            .from(schema.organizations)
            .where(
              sql`position(lower(${q}) in lower(${schema.organizations.name} || ' ' || ${schema.organizations.slug} || ' ' || ${schema.organizations.id}::text)) > 0`,
            )
            .orderBy(schema.organizations.name, schema.organizations.id)
            .limit(26)
            .offset((Number(page) - 1) * 25);
          return {
            workspaces: await Promise.all(
              rows.slice(0, 25).map(async (row) => ({
                id: row.id,
                name: row.name,
                slug: row.slug,
                usage: await organizationUsage(tx, row),
              })),
            ),
            hasMore: rows.length > 25,
          };
        });
      });
      admin.post(
        '/workspaces/:organizationId/entitlements/preview',
        async (request) => {
          const { organizationId } = organizationParams.parse(request.params);
          const change = adminEntitlementPreview.parse(request.body);
          return db.transaction(async (tx) => {
            const [row] = await tx
              .select()
              .from(schema.organizations)
              .where(eq(schema.organizations.id, organizationId))
              .for('no key update');
            if (!row)
              throw new HttpError(
                404,
                'ORGANIZATION_NOT_FOUND',
                'Organization not found.',
              );
            const before = await organizationUsage(tx, row);
            const limit =
              change.siteLimitOverride ?? planSiteLimits[change.planCode];
            return {
              before,
              after: {
                ...before,
                planCode: change.planCode,
                siteLimitOverride: change.siteLimitOverride,
                siteLimit: limit,
                sitesRemaining: Math.max(0, limit - before.sitesUsed),
                canAddSite: before.sitesUsed < limit,
                overLimit: before.sitesUsed > limit,
              },
              expected: {
                planCode: before.planCode,
                siteLimitOverride: before.siteLimitOverride,
                sitesUsed: before.sitesUsed,
                updatedAt: row.updatedAt.toISOString(),
              },
            };
          });
        },
      );
      admin.patch(
        '/workspaces/:organizationId/entitlements',
        async (request) => {
          const { organizationId } = organizationParams.parse(request.params);
          const { expected, ...change } = adminEntitlementSave.parse(
            request.body,
          );
          const user = await requireUser(request);
          const usage = await changeEntitlements(
            db,
            { ...change, organizationId, operator: 'platform-admin' },
            { actorUserId: user.id, requestId: request.id, expected },
          );
          return { usage };
        },
      );
    },
    { prefix: '/api/v1/admin' },
  );
}
