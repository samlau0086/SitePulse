import { and, eq, schema, type Database } from './index';

export async function platformEmailBrand(db: Database) {
  const [row] = await db
    .select()
    .from(schema.platformBranding)
    .where(eq(schema.platformBranding.id, 1));
  return { name: row?.name ?? 'SitePulse', logoUrl: row?.logoUrl ?? null };
}
// Internal mail context only. HTTP callers must authenticate membership before preparing mail.
export async function workspaceEmailBrand(
  db: Database,
  organizationId?: string | null,
) {
  const platform = await platformEmailBrand(db);
  if (!organizationId) return platform;
  const [row] = await db
    .select({
      plan: schema.organizations.planCode,
      name: schema.users.emailBrandName,
      logoUrl: schema.users.emailLogoUrl,
    })
    .from(schema.organizations)
    .innerJoin(
      schema.users,
      eq(schema.users.id, schema.organizations.ownerUserId),
    )
    .innerJoin(
      schema.organizationMembers,
      and(
        eq(schema.organizationMembers.organizationId, schema.organizations.id),
        eq(schema.organizationMembers.userId, schema.users.id),
        eq(schema.organizationMembers.role, 'owner'),
      ),
    )
    .where(eq(schema.organizations.id, organizationId));
  return row && ['agency', 'agency_plus'].includes(row.plan) && row.logoUrl
    ? { name: row.name ?? platform.name, logoUrl: row.logoUrl }
    : platform;
}
