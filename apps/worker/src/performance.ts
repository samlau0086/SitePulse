import { randomUUID } from 'node:crypto';
import { and, eq, schema, sql, type Database } from '@sitepulse/database';
import { performanceReport } from '@sitepulse/api-contracts';
import { fetchPageSpeed, type PageSpeedResult } from './pagespeed';

type Job = typeof schema.performanceJobs.$inferSelect;
const eligible = sql`exists (select 1 from sites s join site_credentials c on c.site_id = s.id
  where s.id = ${schema.performanceJobs.siteId} and s.deleted_at is null and s.status in ('active', 'degraded') and c.revoked_at is null)`;

export async function seedPerformanceJobs(db: Database) {
  await db.execute(sql`insert into performance_jobs (site_id, strategy)
    select s.id, t.strategy from sites s cross join (values ('mobile'), ('desktop')) t(strategy)
    where s.deleted_at is null and s.status in ('active', 'degraded')
      and exists (select 1 from site_credentials c where c.site_id = s.id and c.revoked_at is null)
      and not exists (select 1 from performance_jobs j where j.site_id = s.id and j.strategy = t.strategy)
    order by s.id, t.strategy limit 200 on conflict do nothing`);
}
export async function reschedulePerformanceJobs(
  db: Database,
  intervalSeconds: number,
) {
  await db.execute(sql`update performance_jobs
    set next_run_at = last_attempt_at + (${intervalSeconds} * interval '1 second')
    where last_attempt_at is not null
      and (requested_at is null or requested_at <= last_attempt_at)
      and (lease_expires_at is null or lease_expires_at <= now())`);
}
export async function claimPerformanceJobs(db: Database, budget: number) {
  return db.transaction(async (tx) => {
    // Serialize budget reservations across worker replicas; no network calls under this lock.
    await tx.execute(sql`select pg_advisory_xact_lock(73912046)`);
    const count = await tx.execute<{ used: string }>(
      sql`select count(*)::text as used from performance_checks where checked_at > now() - interval '24 hours'`,
    );
    const remaining = Math.max(0, budget - Number(count.rows[0]!.used));
    if (!remaining) return [];
    const jobs = await tx
      .select()
      .from(schema.performanceJobs)
      .where(
        and(
          eligible,
          sql`${schema.performanceJobs.nextRunAt} <= now()`,
          sql`(${schema.performanceJobs.leaseExpiresAt} is null or ${schema.performanceJobs.leaseExpiresAt} <= now())`,
        ),
      )
      .orderBy(schema.performanceJobs.nextRunAt, schema.performanceJobs.id)
      .limit(Math.min(2, remaining))
      .for('update', { skipLocked: true });
    const claimed: Array<Job & { canonicalUrl: string }> = [];
    for (const job of jobs) {
      const [site] = await tx
        .select()
        .from(schema.sites)
        .where(eq(schema.sites.id, job.siteId));
      if (!site) continue;
      const token = randomUUID();
      const [leased] = await tx
        .update(schema.performanceJobs)
        .set({
          leaseToken: token,
          leaseExpiresAt: sql`now() + interval '180 seconds'`,
          lastAttemptAt: sql`now()`,
        })
        .where(eq(schema.performanceJobs.id, job.id))
        .returning();
      await tx
        .insert(schema.performanceChecks)
        .values({ id: token, siteId: job.siteId, strategy: job.strategy });
      claimed.push({ ...leased!, canonicalUrl: site.canonicalUrl });
    }
    return claimed;
  });
}
export async function finishPerformanceJob(
  db: Database,
  claimed: Job,
  result: PageSpeedResult,
  intervalSeconds = 86400,
) {
  const report = result.report ? performanceReport.parse(result.report) : null;
  return db.transaction(async (tx) => {
    const [site] = await tx
      .select()
      .from(schema.sites)
      .where(eq(schema.sites.id, claimed.siteId))
      .for('update');
    if (
      !site ||
      site.deletedAt ||
      !['active', 'degraded'].includes(site.status)
    )
      return false;
    const [job] = await tx
      .select()
      .from(schema.performanceJobs)
      .where(
        and(
          eq(schema.performanceJobs.id, claimed.id),
          eq(schema.performanceJobs.leaseToken, claimed.leaseToken!),
          sql`${schema.performanceJobs.leaseExpiresAt} > now()`,
          eligible,
        ),
      )
      .for('update');
    if (!job) return false;
    await tx
      .update(schema.performanceChecks)
      .set({
        report,
        errorCode: result.errorCode ?? null,
        completedAt: sql`now()`,
      })
      .where(eq(schema.performanceChecks.id, claimed.leaseToken!));
    await tx
      .update(schema.performanceJobs)
      .set({
        // Retain the last successful report alongside the latest attempt's error.
        ...(report ? { report } : {}),
        errorCode: result.errorCode ?? null,
        nextRunAt: sql`now() + (${intervalSeconds} * interval '1 second')`,
        leaseToken: null,
        leaseExpiresAt: null,
      })
      .where(eq(schema.performanceJobs.id, job.id));
    return true;
  });
}
export async function runPerformance(
  db: Database,
  options: {
    PERFORMANCE_ENABLED: boolean;
    PAGESPEED_API_KEY?: string;
    PERFORMANCE_MAX_DAILY_REQUESTS: number;
    PERFORMANCE_INTERVAL_SECONDS?: number;
  },
  execute = fetchPageSpeed,
) {
  if (!options.PERFORMANCE_ENABLED || !options.PAGESPEED_API_KEY) return 0;
  const intervalSeconds = options.PERFORMANCE_INTERVAL_SECONDS ?? 86400;
  await reschedulePerformanceJobs(db, intervalSeconds);
  await seedPerformanceJobs(db);
  const jobs = await claimPerformanceJobs(
    db,
    options.PERFORMANCE_MAX_DAILY_REQUESTS,
  );
  await Promise.all(
    jobs.map(async (job) => {
      let result: PageSpeedResult;
      try {
        result = await execute(
          job.canonicalUrl,
          job.strategy,
          options.PAGESPEED_API_KEY!,
        );
      } catch {
        result = { errorCode: 'ANALYSIS_UNAVAILABLE' };
      }
      await finishPerformanceJob(db, job, result, intervalSeconds);
    }),
  );
  await db.execute(
    sql`delete from performance_checks where id in (select id from performance_checks where checked_at < now() - interval '30 days' limit 500)`,
  );
  return jobs.length;
}
