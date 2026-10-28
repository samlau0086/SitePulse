'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  uniquePublicVulnerabilities,
  type PublicVulnerability,
  type SiteInventory,
  type SiteSecurityReport,
} from '@sitepulse/api-contracts';
import { Icon } from './icon';

const severityOrder = ['critical', 'high', 'medium', 'low', 'unknown'] as const;
type Severity = PublicVulnerability['severity'];

function label(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function SeverityBadge({ severity }: { severity: Severity }) {
  return (
    <span className={`security-severity severity-${severity}`}>
      <Icon
        name={severity === 'low' || severity === 'unknown' ? 'info' : 'alert'}
      />
      {label(severity)}
    </span>
  );
}

const environmentActions: Record<string, string> = {
  wp_debug_enabled:
    'Ask the site administrator to set WP_DEBUG to false in production. Keep diagnostics in protected logs when needed.',
  debug_display_enabled:
    'Set WP_DEBUG_DISPLAY to false and disable PHP display_errors in the hosting configuration. Keep error logs private, then verify errors are no longer visible to visitors.',
  dashboard_file_editor:
    'Set DISALLOW_FILE_EDIT to true in wp-config.php to disable dashboard code editing. Use a controlled deployment process for code changes.',
  admin_ssl_not_forced:
    'Verify a valid HTTPS certificate and reverse-proxy HTTPS detection, then enable FORCE_SSL_ADMIN. Test administrator login before enforcing it to avoid lockouts.',
  script_debug_enabled:
    'Disable SCRIPT_DEBUG on production after debugging is complete, then clear caches and verify the site.',
};

function advisoryAction(finding: PublicVulnerability) {
  if (finding.supplyChain)
    return 'Review the supply-chain advisory and verify package provenance with the publisher. A version update alone may not resolve this report; ask the administrator to contain affected software if compromise is confirmed.';
  if (!finding.fixedVersion)
    return 'No fixed version is reported. Review the advisory with the maintainer or hosting provider and agree on mitigation; consider disabling or replacing affected software after assessing site impact.';
  if (finding.componentType === 'php')
    return 'Ask your hosting provider or use the server control panel to upgrade PHP to a supported, compatible patched release. Back up and test in staging first; review all advisory boundaries before choosing a version.';
  if (finding.componentType === 'wordpress')
    return 'Back up files and the database, test compatibility in staging, then update WordPress to a supported patched release. Review all matching advisories before choosing a version.';
  return `Back up the site and test a patched ${finding.componentType} release in staging, then use Plugins & themes to review available updates. Check all matching advisories; if no suitable update is available, contact the maintainer or assess a replacement.`;
}

function Recommendation({ children }: { children: React.ReactNode }) {
  return (
    <div className="security-recommendation">
      <strong>
        <Icon name="arrow" /> Recommended action
      </strong>
      <p>{children}</p>
    </div>
  );
}

export function SecurityPanel({
  security,
  inventory,
  softwareHref,
  canManage,
}: {
  security: SiteSecurityReport;
  inventory: SiteInventory | null;
  softwareHref: string;
  canManage: boolean;
}) {
  const [severityFilter, setSeverityFilter] = useState<Severity | null>(null);
  const vulnerabilities = uniquePublicVulnerabilities(
    security.vulnerabilities,
  ).sort(
    (a, b) =>
      severityOrder.indexOf(a.severity) - severityOrder.indexOf(b.severity),
  );
  const environmentRisks = [...security.environmentRisks].sort(
    (a, b) =>
      severityOrder.indexOf(a.severity) - severityOrder.indexOf(b.severity),
  );
  const counts = severityOrder.map((severity) => ({
    severity,
    count: [...environmentRisks, ...vulnerabilities].filter(
      (finding) => finding.severity === severity,
    ).length,
  }));
  const visibleEnvironmentRisks = severityFilter
    ? environmentRisks.filter((risk) => risk.severity === severityFilter)
    : environmentRisks;
  const visibleVulnerabilities = severityFilter
    ? vulnerabilities.filter((finding) => finding.severity === severityFilter)
    : vulnerabilities;
  const advisoryGroups = visibleVulnerabilities.reduce<
    Array<{
      key: string;
      representative: PublicVulnerability;
      advisories: PublicVulnerability[];
    }>
  >((groups, finding) => {
    const key = JSON.stringify([
      finding.componentType,
      finding.component,
      finding.installedVersion,
      finding.title,
      finding.severity,
      finding.fixedVersion,
      finding.supplyChain,
    ]);
    const existing = groups.find((group) => group.key === key);
    if (existing) existing.advisories.push(finding);
    else groups.push({ key, representative: finding, advisories: [finding] });
    return groups;
  }, []);
  return (
    <section className="card security-panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">READ-ONLY ASSESSMENT</p>
          <h2>
            <Icon name="shield" /> WordPress security
          </h2>
        </div>
        <span
          className={`status-badge ${security.status === 'current' ? '' : 'status-warning'}`}
        >
          Assessment: {label(security.status)}
        </span>
      </div>
      <p className="data-note">
        Findings are indicators for review, not proof that a site is safe or
        compromised. Source code and file contents are never uploaded.
        Recommendations require administrator review; no fixes run
        automatically.
      </p>
      <div
        className="security-summary"
        aria-label="Environment and advisory finding counts"
      >
        {counts.map(({ severity, count }) => (
          <button
            type="button"
            key={severity}
            className={severityFilter === severity ? 'is-selected' : undefined}
            aria-pressed={severityFilter === severity}
            aria-label={`Filter by ${label(severity)} severity: ${count} findings`}
            onClick={() =>
              setSeverityFilter((current) =>
                current === severity ? null : severity,
              )
            }
          >
            <SeverityBadge severity={severity} />
            <strong>{count}</strong>
            <span>findings</span>
          </button>
        ))}
      </div>
      <div className="security-filter-status" aria-live="polite">
        <span>
          {severityFilter
            ? `Showing ${label(severityFilter)} environment and advisory findings.`
            : 'Showing all environment and advisory findings.'}
        </span>
        {severityFilter && (
          <button type="button" onClick={() => setSeverityFilter(null)}>
            Clear filter
          </button>
        )}
      </div>
      <p className="data-note">
        Counts include environment risks and advisory matches. Local file
        indicators are listed separately and have no assigned severity.
      </p>
      <dl className="metric-grid security-coverage">
        {(
          [
            ['Inventory coverage', security.coverage.inventory],
            ['Local file coverage', security.coverage.localFiles],
            ['Advisory coverage', security.coverage.publicVulnerabilities],
          ] as const
        ).map(([name, coverage]) => (
          <div key={name}>
            <dt>{name}</dt>
            <dd>
              <span
                className={`status-badge ${coverage === 'complete' ? 'status-healthy' : 'status-warning'}`}
              >
                {label(coverage)}
              </span>
            </dd>
          </div>
        ))}
      </dl>
      {security.status !== 'current' && (
        <p className="notice-warning">
          Assessment {security.status}: stored findings may be incomplete or
          outdated. Sync inventory and allow the next advisory check to complete
          before reassessing. Inventory sync does not force an immediate
          advisory lookup.
        </p>
      )}
      <section
        className="security-section"
        aria-labelledby="environment-heading"
      >
        <h3 id="environment-heading">
          Environment risks{' '}
          <span className="muted">
            ({visibleEnvironmentRisks.length}
            {severityFilter ? ` of ${environmentRisks.length}` : ''})
          </span>
        </h3>
        {inventory?.environment && (
          <p className="data-note">
            Environment: {inventory.environment.environmentType} · WordPress{' '}
            {inventory.wordpressVersion} · PHP {inventory.phpVersion}
          </p>
        )}
        {visibleEnvironmentRisks.length ? (
          <ul className="security-findings">
            {visibleEnvironmentRisks.map((risk) => (
              <li className="security-finding" key={risk.code}>
                <div className="security-finding-heading">
                  <SeverityBadge severity={risk.severity} />
                  <h4>{risk.message}</h4>
                </div>
                <Recommendation>
                  {environmentActions[risk.code] ??
                    'Ask the site administrator to review this environment setting, assess its impact and verify the configuration after making changes.'}
                </Recommendation>
              </li>
            ))}
          </ul>
        ) : (
          <p>
            {severityFilter
              ? `No ${label(severityFilter)} environment risks.`
              : 'No reported environment risks.'}{' '}
            Unknown coverage is not a clean result.
          </p>
        )}
      </section>
      <section className="security-section" aria-labelledby="local-heading">
        <h3 id="local-heading">
          Local file indicators{' '}
          <span className="muted">({security.localFindings.length})</span>
        </h3>
        {security.localFindings.length ? (
          <ul className="security-findings">
            {security.localFindings.map((finding, index) => (
              <li
                className="security-finding"
                key={`${finding.rule}-${finding.path}-${index}`}
              >
                <div className="security-finding-heading">
                  <span className="status-badge status-warning">
                    Review required
                  </span>
                  <h4>{finding.rule.replaceAll('_', ' ')}</h4>
                </div>
                <p>
                  File: <code>{finding.path}</code>
                </p>
                <Recommendation>
                  Have a trusted administrator review this file and compare it
                  with an authentic package or known-good backup. Preserve
                  evidence and assess containment if compromise is confirmed. Do
                  not delete files solely on a pattern match.
                </Recommendation>
              </li>
            ))}
          </ul>
        ) : (
          <p>
            No indicators reported in the available scan scope. Partial or
            unknown coverage requires further review.
          </p>
        )}
      </section>
      <section
        className="security-section"
        aria-labelledby="advisories-heading"
      >
        <h3 id="advisories-heading">
          Public vulnerability matches{' '}
          <span className="muted">
            ({visibleVulnerabilities.length}
            {severityFilter ? ` of ${vulnerabilities.length}` : ''})
          </span>
        </h3>
        <p className="data-note">
          Highest severity first. A fixed boundary applies to one advisory, not
          every issue affecting this component.
        </p>
        {advisoryGroups.length ? (
          <ul className="security-findings">
            {advisoryGroups.map(
              ({ key, representative: finding, advisories }) => (
                <li className="security-finding" key={key}>
                  <div className="security-finding-heading">
                    <SeverityBadge severity={finding.severity} />
                    <h4>{finding.title}</h4>
                    {advisories.length > 1 && (
                      <span className="status-badge">
                        {advisories.length} advisories
                      </span>
                    )}
                  </div>
                  <dl className="security-finding-meta">
                    <div>
                      <dt>Component</dt>
                      <dd>
                        {label(finding.componentType)} · {finding.component}
                      </dd>
                    </div>
                    <div>
                      <dt>Installed version</dt>
                      <dd>{finding.installedVersion}</dd>
                    </div>
                    <div>
                      <dt>Fixed boundary (this advisory)</dt>
                      <dd>
                        {finding.fixedVersion ?? 'No fixed version reported'}
                      </dd>
                    </div>
                  </dl>
                  {advisories.length === 1 ? (
                    <p className="security-advisory-id">
                      Advisory ID: <code>{finding.id}</code>
                    </p>
                  ) : (
                    <details className="security-advisory-details">
                      <summary>
                        View {advisories.length} advisory IDs and sources
                      </summary>
                      <ul>
                        {advisories.map((advisory) => (
                          <li
                            key={`${advisory.id}-${advisory.sourceUrl ?? ''}`}
                          >
                            <code>{advisory.id}</code>
                            {advisory.sourceUrl && (
                              <a
                                href={advisory.sourceUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                Read source ↗
                              </a>
                            )}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                  <Recommendation>{advisoryAction(finding)}</Recommendation>
                  <div className="security-finding-links">
                    {advisories.length === 1 && finding.sourceUrl && (
                      <a
                        href={finding.sourceUrl}
                        aria-label={`Read advisory for ${finding.component}: ${finding.title} (opens in a new tab)`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Read advisory ↗
                      </a>
                    )}
                    {canManage &&
                      (finding.componentType === 'plugin' ||
                        finding.componentType === 'theme') && (
                        <Link href={softwareHref}>
                          Review in Plugins & themes
                        </Link>
                      )}
                  </div>
                </li>
              ),
            )}
          </ul>
        ) : (
          <p>
            {severityFilter
              ? `No ${label(severityFilter)} advisory matches.`
              : 'No matched advisories in the available coverage.'}
          </p>
        )}
      </section>
      <div className="security-scan-details">
        <h3>Scan details</h3>
        {security.errorCode && (
          <p>Assessment unavailable: {security.errorCode}.</p>
        )}
        <p>
          {inventory?.localSecurityScan
            ? `Local scan: ${inventory.localSecurityScan.scannedFiles} files checked, ${inventory.localSecurityScan.skippedFiles} skipped.`
            : 'Local scan unavailable.'}
        </p>
        <p>
          Local scan time:{' '}
          {inventory?.localSecurityScan?.scannedAt ?? 'Not completed'}
        </p>
        <p>Inventory received: {inventory?.receivedAt ?? 'Not received'}</p>
        <p>Last advisory check: {security.checkedAt ?? 'Not completed'}</p>
        {canManage && (
          <Link className="button secondary" href={softwareHref}>
            <Icon name="refresh" /> Sync inventory and refresh code scan
          </Link>
        )}
      </div>
    </section>
  );
}
