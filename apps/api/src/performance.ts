import type {
  PerformanceDevice,
  SitePerformance,
} from '@sitepulse/api-contracts';
import { and, desc, eq, schema, sql, type Database } from '@sitepulse/database';

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
type Job = typeof schema.performanceJobs.$inferSelect;
export function performanceDevices(
  jobs: Job[],
  now = Date.now(),
): PerformanceDevice[] {
  return (['mobile', 'desktop'] as const).map((strategy) => {
    const job = jobs.find((entry) => entry.strategy === strategy);
    const running = !!job?.leaseExpiresAt && job.leaseExpiresAt.getTime() > now;
    const due = !!job && job.nextRunAt.getTime() <= now;
    return {
      strategy,
      state: running
        ? 'running'
        : due
          ? 'queued'
          : job?.errorCode
            ? 'error'
            : !job?.report
              ? 'pending'
              : now - Date.parse(job.report.analyzedAt) > 26 * 3600_000
                ? 'stale'
                : 'ready',
      lastAttemptAt: job?.lastAttemptAt?.toISOString() ?? null,
      nextRunAt: job?.nextRunAt.toISOString() ?? null,
      errorCode: job?.errorCode ?? null,
      report: job?.report ?? null,
    };
  });
}
export function refreshAfter(jobs: Job[]) {
  const last = Math.max(
    0,
    ...jobs.flatMap((job) => [
      job.requestedAt?.getTime() ?? 0,
      job.lastAttemptAt?.getTime() ?? 0,
    ]),
  );
  return last ? new Date(last + 15 * 60_000).toISOString() : null;
}
export async function readPerformance(
  tx: Transaction,
  siteId: string,
  enabled: boolean,
  available: boolean,
): Promise<SitePerformance> {
  const jobs = await tx
    .select()
    .from(schema.performanceJobs)
    .where(eq(schema.performanceJobs.siteId, siteId));
  const devices = performanceDevices(jobs);
  const after = refreshAfter(jobs);
  const history = await tx
    .select()
    .from(schema.performanceChecks)
    .where(
      and(
        eq(schema.performanceChecks.siteId, siteId),
        sql`${schema.performanceChecks.checkedAt} > now() - interval '30 days'`,
      ),
    )
    .orderBy(
      desc(schema.performanceChecks.checkedAt),
      desc(schema.performanceChecks.id),
    )
    .limit(30);
  return {
    enabled,
    available,
    canRefresh:
      enabled &&
      available &&
      (!after || Date.parse(after) <= Date.now()) &&
      !devices.some((d) => d.state === 'running' || d.state === 'queued'),
    refreshAfter: after,
    devices,
    history: history.map((entry) => ({
      id: entry.id,
      strategy: entry.strategy,
      checkedAt: entry.checkedAt.toISOString(),
      completedAt: entry.completedAt?.toISOString() ?? null,
      score: entry.report?.score ?? null,
      errorCode:
        entry.errorCode ??
        (!entry.completedAt && Date.now() - entry.checkedAt.getTime() > 180_000
          ? 'INTERRUPTED'
          : null),
    })),
  };
}
