import type { FastifyInstance, FastifyRequest } from 'fastify';
import { emailBrandInput } from '@sitepulse/api-contracts';
import { and, eq, schema, sql, type Database } from '@sitepulse/database';
import { platformEmailBrand } from '@sitepulse/database/branding';
import { HttpError } from './http-error';

export async function registerAccountBranding(
  app: FastifyInstance,
  {
    db,
    requireUser,
  }: {
    db: Database;
    requireUser: (
      request: FastifyRequest,
    ) => Promise<{ id: string; emailVerified: boolean }>;
  },
) {
  type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
  async function eligible(userId: string, source: Database | Transaction = db) {
    const rows = await source
      .select({ id: schema.organizations.id })
      .from(schema.organizations)
      .innerJoin(
        schema.organizationMembers,
        and(
          eq(
            schema.organizationMembers.organizationId,
            schema.organizations.id,
          ),
          eq(schema.organizationMembers.userId, userId),
          eq(schema.organizationMembers.role, 'owner'),
        ),
      )
      .where(
        and(
          eq(schema.organizations.ownerUserId, userId),
          sql`${schema.organizations.planCode} in ('agency', 'agency_plus')`,
        ),
      )
      .limit(1)
      .for('share');
    return rows.length > 0;
  }
  app.get('/api/v1/users/me/email-branding', async (request) => {
    const user = await requireUser(request);
    const [row] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, user.id));
    const platform = await platformEmailBrand(db);
    return {
      brand: {
        name: row?.emailBrandName ?? platform.name,
        logoUrl: row?.emailLogoUrl ?? null,
      },
      platform,
      canCustomize: user.emailVerified && (await eligible(user.id)),
    };
  });
  app.patch('/api/v1/users/me/email-branding', async (request) => {
    const user = await requireUser(request);
    const brand = emailBrandInput.parse(request.body);
    await db.transaction(async (tx) => {
      if (!user.emailVerified || !(await eligible(user.id, tx)))
        throw new HttpError(
          403,
          'AGENCY_REQUIRED',
          'A verified account owning an Agency workspace is required.',
        );
      await tx
        .update(schema.users)
        .set({ emailBrandName: brand.name, emailLogoUrl: brand.logoUrl })
        .where(eq(schema.users.id, user.id));
      await tx.insert(schema.auditLogs).values({
        actorUserId: user.id,
        action: 'account.email_branding.updated',
        requestId: request.id,
      });
    });
    return { brand };
  });
}
