import { randomUUID } from 'node:crypto';
import { and, eq, schema, sql, type Database } from '@sitepulse/database';

// A bounded batch and SKIP LOCKED allow multiple workers without duplicate transitions.
export async function expireHeartbeats(db: Database, staleSeconds = 2700) {
  return db.transaction(async (tx) => {
    const cutoff = sql`now() - make_interval(secs => ${staleSeconds}::int)`;
    const stale = await tx
      .select()
      .from(schema.sites)
      .where(
        and(
          sql`${schema.sites.deletedAt} is null`,
          sql`${schema.sites.status} in ('active', 'pending')`,
          // Pending paired sites that never send their first heartbeat also expire.
          sql`coalesce(${schema.sites.lastSeenAt}, ${schema.sites.updatedAt}) < ${cutoff}`,
          sql`exists (select 1 from ${schema.siteCredentials} where ${schema.siteCredentials.siteId} = ${schema.sites.id} and ${schema.siteCredentials.revokedAt} is null)`,
        ),
      )
      .limit(200)
      .for('update', { skipLocked: true });
    for (const site of stale) {
      await tx
        .update(schema.sites)
        .set({ status: 'degraded' })
        .where(eq(schema.sites.id, site.id));
      await tx.insert(schema.auditLogs).values({
        organizationId: site.organizationId,
        action: 'site.heartbeat_stale',
        requestId: randomUUID(),
        metadata: { siteId: site.id },
      });
    }
    return stale.length;
  });
}
