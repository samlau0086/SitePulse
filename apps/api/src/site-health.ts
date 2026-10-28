import type { SiteHealthSummary } from '@sitepulse/api-contracts';
import type { schema } from '@sitepulse/database';
import { buildSecurityReport } from './security-report';

export function directoryHealth(
  site: Pick<typeof schema.sites.$inferSelect, 'status'>,
  inventory: typeof schema.siteInventorySnapshots.$inferSelect | null,
  assessment: typeof schema.siteSecurityAssessments.$inferSelect | null,
  uptime: Pick<
    typeof schema.monitorJobs.$inferSelect,
    'state' | 'lastCheckedAt' | 'nextRunAt'
  > | null,
  now = Date.now(),
): SiteHealthSummary {
  const security = buildSecurityReport(site, inventory, assessment);
  const severityOrder = [
    'critical',
    'high',
    'medium',
    'low',
    'unknown',
  ] as const;
  const severities = [
    ...security.environmentRisks,
    ...security.vulnerabilities,
  ].map((item) => item.severity);
  const state =
    site.status === 'disconnected'
      ? 'disabled'
      : !uptime?.lastCheckedAt || uptime.state === 'pending'
        ? 'pending'
        : // An overdue scheduled probe is not evidence of current availability.
          now > uptime.nextRunAt.getTime() + 5 * 60_000
          ? 'stale'
          : uptime.state === 'healthy'
            ? 'up'
            : uptime.state === 'down' ||
                uptime.state === 'recovering' ||
                uptime.state === 'suspected'
              ? uptime.state
              : 'pending';
  return {
    availability: {
      state,
      lastCheckedAt: uptime?.lastCheckedAt?.toISOString() ?? null,
    },
    security: {
      status: security.status,
      coverage: security.coverage,
      checkedAt: security.checkedAt,
      highestSeverity:
        severityOrder.find((severity) => severities.includes(severity)) ?? null,
      environmentRisks: security.environmentRisks.length,
      vulnerabilities: security.vulnerabilities.length,
      localIndicators: security.localFindings.length,
    },
  };
}
