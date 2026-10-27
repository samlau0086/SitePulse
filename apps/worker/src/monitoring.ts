import { randomUUID } from 'node:crypto';
import { enqueueIncidentNotifications } from '@sitepulse/database/incidents';
import { and, eq, schema, sql, type Database } from '@sitepulse/database';
import { probe, type ProbeResult } from './probe';
import { nextProbeDelay } from './scheduling';

type Job = typeof schema.monitorJobs.$inferSelect;
type Options = {
  MONITOR_INTERVAL_SECONDS: number;
  SSL_INTERVAL_SECONDS: number;
};
const eligible = sql`exists (select 1 from sites s join site_credentials c on c.site_id = s.id
  where s.id = ${schema.monitorJobs.siteId} and s.deleted_at is null and s.status <> 'disconnected' and c.revoked_at is null)`;

export async function seedMonitorJobs(db: Database) {
  await db.execute(sql`insert into monitor_jobs (site_id, monitor_type)
    select s.id, t.kind from sites s cross join (values ('uptime'), ('ssl')) as t(kind)
    where s.deleted_at is null and s.status <> 'disconnected'
      and (t.kind <> 'ssl' or s.canonical_url like 'https://%')
      and exists (select 1 from site_credentials c where c.site_id = s.id and c.revoked_at is null)
      and not exists (select 1 from monitor_jobs j where j.site_id = s.id and j.monitor_type = t.kind)
    order by s.id, t.kind limit 200 on conflict do nothing`);
}

export async function claimMonitorJobs(db: Database) {
  return db.transaction(async (tx) => {
    const jobs = await tx
      .select()
      .from(schema.monitorJobs)
      .where(
        and(
          eligible,
          sql`${schema.monitorJobs.nextRunAt} <= now()`,
          sql`(${schema.monitorJobs.leaseExpiresAt} is null or ${schema.monitorJobs.leaseExpiresAt} <= now())`,
        ),
      )
      .orderBy(schema.monitorJobs.nextRunAt)
      .limit(4)
      .for('update', { skipLocked: true });
    const claimed: Array<Job & { canonicalUrl: string }> = [];
    for (const job of jobs) {
      const [site] = await tx
        .select()
        .from(schema.sites)
        .where(eq(schema.sites.id, job.siteId));
      const [leased] = await tx
        .update(schema.monitorJobs)
        .set({
          leaseToken: randomUUID(),
          leaseExpiresAt: sql`now() + interval '90 seconds'`,
        })
        .where(eq(schema.monitorJobs.id, job.id))
        .returning();
      if (site && leased)
        claimed.push({ ...leased, canonicalUrl: site.canonicalUrl });
    }
    return claimed;
  });
}

export async function finishMonitorJob(
  db: Database,
  claimed: Job,
  result: ProbeResult,
  options: Options,
) {
  return db.transaction(async (tx) => {
    // Site first, matching disconnect/delete/heartbeat lock order. Never hold DB locks during network I/O.
    const [site] = await tx
      .select()
      .from(schema.sites)
      .where(eq(schema.sites.id, claimed.siteId))
      .for('update');
    if (!site || site.deletedAt || site.status === 'disconnected') return false;
    const [job] = await tx
      .select()
      .from(schema.monitorJobs)
      .where(
        and(
          eq(schema.monitorJobs.id, claimed.id),
          eq(schema.monitorJobs.leaseToken, claimed.leaseToken!),
          sql`${schema.monitorJobs.leaseExpiresAt} > now()`,
          eligible,
        ),
      )
      .for('update');
    if (!job) return false; // Fencing rejects stale/retried workers and results from a previous connection.
    const [active] = await tx
      .select()
      .from(schema.incidents)
      .where(
        and(
          eq(schema.incidents.siteId, job.siteId),
          eq(schema.incidents.monitorType, job.monitorType),
          sql`${schema.incidents.status} <> 'resolved'`,
        ),
      );
    const bad = result.result !== 'up';
    const failures = bad ? Math.min(job.failures + 1, 100) : 0;
    const successes = bad ? 0 : Math.min(job.successes + 1, 100);
    let state: Job['state'] = bad ? 'suspected' : 'healthy';
    const severity = result.result === 'warning' ? 'warning' : 'critical';
    const audit = async (action: string, incidentId: string) => {
      await tx.insert(schema.auditLogs).values({
        organizationId: site.organizationId,
        action,
        requestId: randomUUID(),
        metadata: {
          siteId: site.id,
          incidentId,
          monitorType: job.monitorType,
        },
      });
    };
    if (bad && (failures >= 2 || active)) {
      state = severity === 'warning' ? 'warning' : 'down';
      if (!active) {
        const [created] = await tx
          .insert(schema.incidents)
          .values({
            siteId: job.siteId,
            monitorType: job.monitorType,
            severity,
            fingerprint: `${job.siteId}:${job.monitorType}`,
          })
          .returning();
        await enqueueIncidentNotifications(tx, site, created!, 'opened');
        await audit('monitor.incident_opened', created!.id);
      } else if (active.severity !== severity) {
        await tx
          .update(schema.incidents)
          .set({ severity })
          .where(eq(schema.incidents.id, active.id));
        await audit('monitor.incident_severity_changed', active.id);
      }
    } else if (!bad && active) {
      state = successes >= 2 ? 'healthy' : 'recovering';
      if (successes >= 2) {
        const resolved = { ...active, status: 'resolved' as const };
        await enqueueIncidentNotifications(tx, site, resolved, 'recovered');
        await tx
          .update(schema.incidents)
          .set({
            status: 'resolved',
            resolvedAt: sql`now()`,
            resolutionReason: 'recovered',
          })
          .where(eq(schema.incidents.id, active.id));
        await audit('monitor.incident_resolved', active.id);
      }
    }
    await tx
      .insert(schema.monitorChecks)
      .values({ siteId: job.siteId, monitorType: job.monitorType, ...result });
    const interval =
      job.monitorType === 'uptime'
        ? options.MONITOR_INTERVAL_SECONDS
        : options.SSL_INTERVAL_SECONDS;
    const delay = nextProbeDelay(
      interval,
      bad,
      failures,
      state === 'recovering',
    );
    await tx
      .update(schema.monitorJobs)
      .set({
        state,
        failures,
        successes,
        lastCheckedAt: sql`now()`,
        leaseToken: null,
        leaseExpiresAt: null,
        nextRunAt: sql`now() + make_interval(secs => ${delay}::int)`,
      })
      .where(eq(schema.monitorJobs.id, job.id));
    return true;
  });
}

export async function runMonitoring(
  db: Database,
  options: Options,
  execute = probe,
) {
  await seedMonitorJobs(db);
  await tightenMonitorSchedule(db, options.MONITOR_INTERVAL_SECONDS);
  const jobs = await claimMonitorJobs(db);
  await Promise.all(
    jobs.map(async (job) => {
      const result = await execute(job.canonicalUrl, job.monitorType);
      await finishMonitorJob(db, job, result, options);
    }),
  );
  // Bounded cleanup: checks 30 days, resolved incidents 90 days; open incidents survive.
  await db.execute(
    sql`delete from monitor_checks where id in (select id from monitor_checks where checked_at < now() - interval '30 days' limit 500)`,
  );
  await db.execute(
    sql`delete from incidents where id in (select id from incidents where status = 'resolved' and resolved_at < now() - interval '90 days' limit 500)`,
  );
  return jobs.length;
}

// Apply shorter intervals to existing healthy jobs, without delaying due work,
// disturbing confirmation/recovery retries or stealing in-flight leases.
export async function tightenMonitorSchedule(db: Database, interval: number) {
  await db.execute(sql`with candidates as (
    select id from monitor_jobs where monitor_type = 'uptime' and state = 'healthy'
      and last_checked_at is not null
      and (lease_expires_at is null or lease_expires_at <= now())
      and next_run_at > last_checked_at + make_interval(secs => ${interval}::int)
    order by next_run_at limit 200 for update skip locked
  ) update monitor_jobs set next_run_at = last_checked_at + make_interval(secs => ${interval}::int)
    where id in (select id from candidates)`);
}
