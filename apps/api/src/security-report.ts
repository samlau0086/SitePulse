import type { SiteSecurityReport } from '@sitepulse/api-contracts';
import type { schema } from '@sitepulse/database';

export function buildSecurityReport(
  site: Pick<typeof schema.sites.$inferSelect, 'status'>,
  inventory:
    typeof schema.siteInventorySnapshots.$inferSelect | null | undefined,
  assessment:
    typeof schema.siteSecurityAssessments.$inferSelect | null | undefined,
): SiteSecurityReport {
  const environmentRisks: SiteSecurityReport['environmentRisks'] = [];
  if (inventory?.environment) {
    if (
      inventory.environment.environmentType === 'production' &&
      inventory.environment.wpDebug
    )
      environmentRisks.push({
        code: 'wp_debug_enabled',
        severity: 'high',
        message: 'WP_DEBUG is enabled in production.',
      });
    if (inventory.environment.wpDebugDisplay)
      environmentRisks.push({
        code: 'debug_display_enabled',
        severity: 'high',
        message: 'PHP error details may be displayed to visitors.',
      });
    if (!inventory.environment.disallowFileEdit)
      environmentRisks.push({
        code: 'dashboard_file_editor',
        severity: 'medium',
        message: 'The WordPress dashboard file editor is enabled.',
      });
    if (!inventory.environment.forceSslAdmin)
      environmentRisks.push({
        code: 'admin_ssl_not_forced',
        severity: 'medium',
        message: 'WordPress does not force HTTPS for administration.',
      });
    if (inventory.environment.scriptDebug)
      environmentRisks.push({
        code: 'script_debug_enabled',
        severity: 'low',
        message: 'SCRIPT_DEBUG is enabled.',
      });
  }
  const age = assessment?.checkedAt
    ? Date.now() - assessment.checkedAt.getTime()
    : Number.POSITIVE_INFINITY;
  const security: SiteSecurityReport = {
    status: !assessment
      ? 'pending'
      : assessment.status === 'current' &&
          (age > 48 * 60 * 60 * 1000 ||
            site.status !== 'active' ||
            !inventory ||
            Date.now() - inventory.receivedAt.getTime() > 60 * 60 * 1000)
        ? 'stale'
        : assessment.status,
    checkedAt: assessment?.checkedAt?.toISOString() ?? null,
    nextCheckAt: assessment?.nextCheckAt.toISOString() ?? null,
    coverage: {
      inventory:
        inventory?.installedPlugins && inventory.installedThemes
          ? inventory.environment?.inventoryComplete === false ||
            inventory.installedPlugins.length >= 200 ||
            inventory.installedThemes.length >= 20
            ? 'partial'
            : 'complete'
          : 'unknown',
      localFiles:
        inventory?.localSecurityScan?.status === 'complete'
          ? 'complete'
          : inventory?.localSecurityScan?.status === 'partial'
            ? 'partial'
            : 'unknown',
      publicVulnerabilities: assessment?.coverage ?? 'unknown',
    },
    environmentRisks,
    localFindings: inventory?.localSecurityScan?.findings ?? [],
    vulnerabilities: assessment?.vulnerabilities ?? [],
    errorCode: assessment?.errorCode ?? null,
  };
  return security;
}
