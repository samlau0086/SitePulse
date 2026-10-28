import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cookies } from 'next/headers';
import { parseWebEnvironment } from '@sitepulse/config';
import type {
  Organization,
  Site,
  SiteInventory,
  MonitorState,
  MonitorCheck,
  Incident,
  SiteSecurityReport,
} from '@sitepulse/api-contracts';
import { serverApi } from '../../../../lib/server-api';
import { SiteControls } from '../../../../components/sites-panel';
import { MonitoringPanel } from '../../../../components/monitoring-panel';
import { SecurityPanel } from '../../../../components/security-panel';
import { SiteTabs } from '../../../../components/site-tabs';

export default async function SitePage({
  params,
  searchParams,
}: {
  params: Promise<{ siteId: string }>;
  searchParams: Promise<{ view?: string }>;
}) {
  const { siteId } = await params;
  const requestedView = (await searchParams).view;
  const view =
    requestedView === 'inventory' ||
    requestedView === 'security' ||
    requestedView === 'connection'
      ? requestedView
      : 'monitoring';
  if (!/^[0-9a-f-]{36}$/i.test(siteId)) notFound();
  const { user } = await serverApi<{ user: { emailVerified: boolean } }>(
    '/auth/session',
  );
  const env = parseWebEnvironment(process.env);
  const response = await fetch(
    `${env.API_INTERNAL_ORIGIN}/api/v1/sites/${siteId}`,
    { headers: { cookie: (await cookies()).toString() }, cache: 'no-store' },
  );
  if (response.status === 404 || response.status === 400) notFound();
  if (!response.ok) throw new Error('Unable to load site.');
  const { site, inventory, monitoring, security } = (await response.json()) as {
    site: Site;
    inventory: SiteInventory | null;
    monitoring: MonitorState[];
    security: SiteSecurityReport;
  };
  const { organization } = await serverApi<{ organization: Organization }>(
    `/organizations/${site.organizationId}`,
  );
  const [{ checks }, { incidents }] = await Promise.all([
    serverApi<{ checks: MonitorCheck[] }>(`/sites/${siteId}/checks`),
    serverApi<{ incidents: Incident[] }>(`/sites/${siteId}/incidents`),
  ]);
  return (
    <main>
      <div className="page-heading">
        <div>
          <p className="eyebrow">{organization.name} / SITE OPERATIONS</p>
          <h1>{site.name}</h1>
          <p className="muted">{site.canonicalUrl}</p>
        </div>
        <Link className="button secondary" href="/app/sites">
          All sites
        </Link>
      </div>
      <SiteTabs
        siteId={siteId}
        organizationId={site.organizationId}
        view={view}
      />
      {view === 'connection' && (
        <section className="card">
          <p>
            Connector status:{' '}
            {site.status === 'degraded' ? 'Stale heartbeat' : site.status}
          </p>
          <p>
            Last heartbeat:{' '}
            {site.lastSeenAt
              ? new Date(site.lastSeenAt).toISOString()
              : 'Not received'}
          </p>
          <p>Connector version: {site.connectorVersion ?? 'Not received'}</p>
        </section>
      )}
      {view === 'monitoring' && (
        <MonitoringPanel
          monitoring={monitoring}
          checks={checks}
          incidents={incidents}
          https={site.canonicalUrl.startsWith('https://')}
          canManage={organization.role !== 'member' && user.emailVerified}
        />
      )}
      {view === 'inventory' && (
        <section className="card">
          <h2>Site inventory</h2>
          {!inventory ? (
            <p>
              Inventory has not been reported yet. The connector will send it
              after the next successful sync.
            </p>
          ) : (
            <>
              <p>
                WordPress {inventory.wordpressVersion} · PHP{' '}
                {inventory.phpVersion}
              </p>
              <p>
                Updates available: {inventory.updateCounts.core} core,{' '}
                {inventory.updateCounts.plugins} plugins,{' '}
                {inventory.updateCounts.themes} themes.
              </p>
              <p>Received: {new Date(inventory.receivedAt).toISOString()}</p>
              <h3>Installed plugins</h3>
              {inventory.installedPlugins !== null ? (
                <ul>
                  {inventory.installedPlugins.map((item) => (
                    <li key={item.identifier}>
                      {item.name} ({item.version}) ·{' '}
                      {item.active ? 'Active' : 'Inactive'}
                      {' · '}
                      {item.source}
                      {item.updateVersion
                        ? ` · Update ${item.updateVersion}`
                        : ''}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>Full plugin inventory requires Connector 0.2.0 or newer.</p>
              )}
              <h3>Installed themes</h3>
              {inventory.installedThemes !== null ? (
                <ul>
                  {inventory.installedThemes.map((item) => (
                    <li key={item.identifier}>
                      {item.name} ({item.version}) ·{' '}
                      {item.active ? 'Active' : 'Inactive'}
                      {' · '}
                      {item.source}
                      {item.updateVersion
                        ? ` · Update ${item.updateVersion}`
                        : ''}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>Full theme inventory requires Connector 0.2.0 or newer.</p>
              )}
            </>
          )}
        </section>
      )}
      {view === 'security' && (
        <SecurityPanel
          security={security}
          inventory={inventory}
          softwareHref={`/app/software?workspace=${site.organizationId}&site=${siteId}`}
          canManage={organization.role !== 'member' && user.emailVerified}
        />
      )}
      {view === 'connection' &&
        organization.role !== 'member' &&
        (user.emailVerified ? (
          <SiteControls siteId={siteId} />
        ) : (
          <Link href="/verify-email">Verify email to manage this site</Link>
        ))}
    </main>
  );
}
