import Link from 'next/link';
import { workspaceData } from '../../lib/workspace';
import { Icon, type IconName } from '../../components/icon';
import { ConnectionSummary } from '../../components/connection-summary';
import {
  SiteDirectory,
  IncidentDirectory,
} from '../../components/workspace-directory';

export default async function WorkspacePage() {
  const { organizations, sites, incidents } = await workspaceData();
  const outstanding = incidents.filter(
    (incident) => incident.status !== 'resolved',
  );
  return (
    <main>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Your website workspace</p>
          <h1>Overview</h1>
          <p className="muted">Your sites, connections and recent incidents.</p>
        </div>
        <Link className="button" href="/app/sites/new">
          <Icon name="plus" /> Add site
        </Link>
      </div>
      <div className="metric-grid">
        {[
          ['Registered sites', sites.length, 'globe', 'info'],
          [
            'Active connectors',
            sites.filter((site) => site.status === 'active').length,
            'pulse',
            'success',
          ],
          [
            'Stale heartbeats',
            sites.filter((site) => site.status === 'degraded').length,
            'clock',
            'warning',
          ],
          ['Recent unresolved', outstanding.length, 'alert', 'danger'],
        ].map(([label, value, icon, tone]) => (
          <section className="metric" key={label}>
            <div className="metric-heading">
              <span className="muted">{label}</span>
              <span className={`icon-tile tone-${tone}`}>
                <Icon name={icon as IconName} />
              </span>
            </div>
            <strong>{value}</strong>
          </section>
        ))}
      </div>
      <p className="data-note">
        Incident totals cover the latest 100 incidents per workspace.
      </p>
      <ConnectionSummary sites={sites} unresolved={outstanding.length} />
      <div className="section-heading">
        <h2>
          <Icon name="globe" /> Your sites
        </h2>
        <Link href="/app/sites">View all sites →</Link>
      </div>
      <SiteDirectory
        sites={sites.slice(0, 6)}
        organizations={organizations}
        incidents={incidents}
        compact
      />
      <div className="section-heading">
        <h2>
          <Icon name="pulse" /> Recent incidents
        </h2>
        <Link href="/app/incidents">View incident history →</Link>
      </div>
      <IncidentDirectory
        sites={sites}
        organizations={organizations}
        incidents={incidents.slice(0, 5)}
        canManage={false}
        compact
      />
    </main>
  );
}
