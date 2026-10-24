import Link from 'next/link';
import { workspaceData } from '../../lib/workspace';
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
          <p className="eyebrow">YOUR OPERATIONS AT A GLANCE</p>
          <h1>Overview</h1>
          <p className="muted">Your sites, connections and recent incidents.</p>
        </div>
        <Link className="button" href="/app/sites/new">
          + Add site
        </Link>
      </div>
      <div className="metric-grid">
        {[
          ['Registered sites', sites.length],
          [
            'Active connectors',
            sites.filter((site) => site.status === 'active').length,
          ],
          [
            'Stale heartbeats',
            sites.filter((site) => site.status === 'degraded').length,
          ],
          ['Unresolved in recent history', outstanding.length],
        ].map(([label, value]) => (
          <section className="metric" key={label}>
            <span className="muted">{label}</span>
            <strong>{value}</strong>
          </section>
        ))}
      </div>
      <p className="data-note">
        Connector activity is separate from HTTP availability. Incident totals
        cover the latest 100 incidents per workspace.
      </p>
      <div className="section-heading">
        <h2>Site directory</h2>
        <Link href="/app/sites">View all sites →</Link>
      </div>
      <SiteDirectory
        sites={sites.slice(0, 6)}
        organizations={organizations}
        incidents={incidents}
        compact
      />
      <div className="section-heading">
        <h2>Recent incidents</h2>
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
