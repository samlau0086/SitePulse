import { randomUUID } from 'node:crypto';
import { and, eq, schema, sql, type Database } from './index';

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
type Site = typeof schema.sites.$inferSelect;

// Caller holds the site lock. All incident sources share recipient policy and event keys.
export async function enqueueIncidentNotifications(
  tx: Transaction,
  site: Site,
  incident: typeof schema.incidents.$inferSelect,
  eventType: 'opened' | 'recovered',
) {
  const members = await tx
    .select({ email: schema.users.email })
    .from(schema.organizationMembers)
    .innerJoin(
      schema.users,
      eq(schema.users.id, schema.organizationMembers.userId),
    )
    .where(
      and(
        eq(schema.organizationMembers.organizationId, site.organizationId),
        eq(schema.users.emailVerified, true),
      ),
    );
  const [settings] = await tx
    .select()
    .from(schema.notificationSettings)
    .where(eq(schema.notificationSettings.organizationId, site.organizationId));
  const endpoints = await tx
    .select()
    .from(schema.notificationEndpoints)
    .where(
      eq(schema.notificationEndpoints.organizationId, site.organizationId),
    );
  const recipients = new Map<string, string | null>();
  if (settings?.includeMembers !== false)
    for (const { email } of members) {
      const normalized = email.toLowerCase();
      // Disabled/deleted managed endpoints must not fall back to member delivery.
      if (!endpoints.some((row) => row.destination === normalized))
        recipients.set(normalized, null);
    }
  for (const row of endpoints)
    if (row.enabled && row.verifiedAt && !row.deletedAt)
      recipients.set(row.destination, row.id);
  if (!recipients.size) return;
  await tx
    .insert(schema.notificationDeliveries)
    .values(
      [...recipients].map(([email, endpointId]) => ({
        organizationId: site.organizationId,
        endpointId,
        incidentId: incident.id,
        eventKey: `${incident.id}:${eventType}:${email}`,
        eventType,
        recipient: email,
        channel:
          endpoints.find((row) => row.id === endpointId)?.type ?? 'email',
        siteName: site.name,
        siteUrl: site.canonicalUrl,
        monitorType: incident.monitorType,
        severity: incident.severity,
      })),
    )
    .onConflictDoNothing();
}

// Only call after an authenticated, non-replayed heartbeat, under the site lock.
export async function recoverConnectorIncident(tx: Transaction, site: Site) {
  const [incident] = await tx
    .update(schema.incidents)
    .set({
      status: 'resolved',
      resolvedAt: sql`now()`,
      resolutionReason: 'recovered',
    })
    .where(
      and(
        eq(schema.incidents.siteId, site.id),
        eq(schema.incidents.monitorType, 'stale_data'),
        sql`${schema.incidents.status} <> 'resolved'`,
      ),
    )
    .returning();
  if (!incident) return;
  await enqueueIncidentNotifications(tx, site, incident, 'recovered');
  await tx.insert(schema.auditLogs).values({
    organizationId: site.organizationId,
    action: 'site.heartbeat_recovered',
    requestId: randomUUID(),
    metadata: { siteId: site.id, incidentId: incident.id },
  });
}
