import { randomUUID } from 'node:crypto';
import { planSiteLimits } from '@sitepulse/config';
import {
  entitlementChange,
  planCode,
  type OrganizationUsage,
} from '@sitepulse/api-contracts';
import { and, eq, schema, sql, type Database } from '@sitepulse/database';
import { HttpError } from './http-error';

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

// Call with the organization row locked when a consistent quota decision is required.
export async function organizationUsage(
  tx: Transaction,
  organization: typeof schema.organizations.$inferSelect,
): Promise<OrganizationUsage> {
  const plan = planCode.parse(organization.planCode);
  const limit = organization.siteLimitOverride ?? planSiteLimits[plan];
  const [count] = await tx
    .select({ used: sql<number>`count(*)::integer` })
    .from(schema.sites)
    .where(
      and(
        eq(schema.sites.organizationId, organization.id),
        sql`${schema.sites.deletedAt} is null`,
      ),
    );
  const used = count?.used ?? 0;
  return {
    planCode: plan,
    siteLimit: limit,
    siteLimitOverride: organization.siteLimitOverride,
    sitesUsed: used,
    sitesRemaining: Math.max(0, limit - used),
    canAddSite: used < limit,
    overLimit: used > limit,
  };
}

export async function requireSiteSlot(tx: Transaction, organizationId: string) {
  // All operations which increase usage and operator entitlement changes take this lock.
  // PostgreSQL READ COMMITTED gives the following count a fresh snapshot after waiting.
  const [organization] = await tx
    .select()
    .from(schema.organizations)
    .where(eq(schema.organizations.id, organizationId))
    .for('no key update');
  if (!organization)
    throw new HttpError(
      404,
      'ORGANIZATION_NOT_FOUND',
      'Organization not found.',
    );
  const usage = await organizationUsage(tx, organization);
  if (!usage.canAddSite)
    throw new HttpError(
      409,
      'SITE_LIMIT_REACHED',
      `Site limit reached (${usage.sitesUsed}/${usage.siteLimit}). Delete a site or contact your operator to adjust workspace entitlements.`,
    );
  return usage;
}

export async function changeEntitlements(
  db: Database,
  input: unknown,
  context?: {
    actorUserId: string;
    requestId: string;
    expected: {
      planCode: string;
      siteLimitOverride: number | null;
      sitesUsed: number;
      updatedAt: string;
    };
  },
) {
  const change = entitlementChange.parse(input);
  return db.transaction(async (tx) => {
    const [organization] = await tx
      .select()
      .from(schema.organizations)
      .where(eq(schema.organizations.id, change.organizationId))
      .for('no key update');
    if (!organization)
      throw new HttpError(
        404,
        'ORGANIZATION_NOT_FOUND',
        'Organization not found.',
      );
    const before = await organizationUsage(tx, organization);
    if (
      context &&
      (context.expected.planCode !== before.planCode ||
        context.expected.siteLimitOverride !== before.siteLimitOverride ||
        context.expected.sitesUsed !== before.sitesUsed ||
        context.expected.updatedAt !== organization.updatedAt.toISOString())
    )
      throw new HttpError(
        409,
        'PREVIEW_EXPIRED',
        'Workspace changed. Preview the impact again before saving.',
      );
    const [updated] = await tx
      .update(schema.organizations)
      .set({
        planCode: change.planCode,
        siteLimitOverride: change.siteLimitOverride,
        updatedAt: new Date(),
      })
      .where(eq(schema.organizations.id, organization.id))
      .returning();
    if (!updated) throw new Error('Organization update failed');
    const after = await organizationUsage(tx, updated);
    await tx.insert(schema.auditLogs).values({
      organizationId: organization.id,
      action: 'organization.entitlements.updated',
      requestId: context?.requestId ?? randomUUID(),
      actorUserId: context?.actorUserId ?? null,
      metadata: {
        operator: change.operator,
        reason: change.reason,
        previousPlan: before.planCode,
        plan: after.planCode,
        previousOverride: String(before.siteLimitOverride),
        siteLimitOverride: String(after.siteLimitOverride),
        previousLimit: String(before.siteLimit),
        siteLimit: String(after.siteLimit),
        sitesUsed: String(after.sitesUsed),
      },
    });
    return after;
  });
}
