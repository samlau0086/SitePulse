import { randomUUID } from 'node:crypto';
import { enqueueIncidentNotifications } from '@sitepulse/database/incidents';
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
          sql`${schema.sites.status} in ('active', 'pending', 'degraded')`,
          // Pending paired sites that never send their first heartbeat also expire.
          sql`coalesce(${schema.sites.lastSeenAt}, ${schema.sites.updatedAt}) < ${cutoff}`,
          sql`exists (select 1 from ${schema.siteCredentials} where ${schema.siteCredentials.siteId} = ${schema.sites.id} and ${schema.siteCredentials.revokedAt} is null)`,
          sql`not exists (select 1 from ${schema.incidents} where ${schema.incidents.siteId} = ${schema.sites.id} and ${schema.incidents.monitorType} = 'stale_data' and ${schema.incidents.status} <> 'resolved')`,
        ),
      )
      .limit(200)
      .for('update', { skipLocked: true });
    let expired = 0;
    for (const site of stale) {
      // Fresh statement snapshot after the site lock: another sweep may have
      // committed its incident while this SELECT was evaluating its candidates.
      const [active] = await tx
        .select({ id: schema.incidents.id })
        .from(schema.incidents)
        .where(
          and(
            eq(schema.incidents.siteId, site.id),
            eq(schema.incidents.monitorType, 'stale_data'),
            sql`${schema.incidents.status} <> 'resolved'`,
          ),
        );
      if (active) continue;
      await tx
        .update(schema.sites)
        .set({ status: 'degraded' })
        .where(eq(schema.sites.id, site.id));
      const [incident] = await tx
        .insert(schema.incidents)
        .values({
          siteId: site.id,
          monitorType: 'stale_data',
          severity: 'warning',
          fingerprint: `${site.id}:stale_data`,
        })
        .returning();
      await enqueueIncidentNotifications(tx, site, incident!, 'opened');
      await tx.insert(schema.auditLogs).values({
        organizationId: site.organizationId,
        action: 'site.heartbeat_stale',
        requestId: randomUUID(),
        metadata: { siteId: site.id, incidentId: incident!.id },
      });
      expired++;
    }
    return expired;
  });
}
