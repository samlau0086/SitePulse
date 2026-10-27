'use client';
import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { Incident, Organization, Site } from '@sitepulse/api-contracts';
import { IncidentAction } from './incident-action';
import { IncidentSignal } from './incident-signal';
import { api } from '../lib/api';
import { PlanUsage } from './plan-usage';
import { Icon } from './icon';

type DirectoryProps = {
  sites: Site[];
  organizations: Organization[];
  incidents: Incident[];
  compact?: boolean;
};
export function filterSites(
  sites: Site[],
  query: string,
  organizationId: string,
) {
  const needle = query.trim().toLowerCase();
  return sites.filter(
    (site) =>
      (!organizationId || site.organizationId === organizationId) &&
      `${site.name} ${site.hostname}`.toLowerCase().includes(needle),
  );
}
export function Timestamp({ value }: { value: string | null }) {
  return value ? (
    <time dateTime={value}>
      {new Date(value).toISOString().replace('T', ' ').slice(0, 16)} UTC
    </time>
  ) : (
    <>Not received</>
  );
}
export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`status-badge status-${status}`}>
      <Icon
        name={
          ['active', 'resolved', 'healthy'].includes(status)
            ? 'check'
            : ['degraded', 'warning', 'acknowledged'].includes(status)
              ? 'clock'
              : ['critical', 'open', 'down'].includes(status)
                ? 'alert'
                : 'info'
        }
      />
      {status === 'degraded' ? 'Stale heartbeat' : status.replaceAll('_', ' ')}
    </span>
  );
}
function WorkspaceFilter({
  organizations,
  value,
  onChange,
}: {
  organizations: Organization[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="filter-label">
      Workspace
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">All workspaces</option>
        {organizations.map((organization) => (
          <option key={organization.id} value={organization.id}>
            {organization.name}
          </option>
        ))}
      </select>
    </label>
  );
}
export function SiteDirectory({
  sites,
  organizations,
  incidents,
  compact = false,
}: DirectoryProps) {
  const [query, setQuery] = useState('');
  const [workspace, setWorkspace] = useState('');
  const filtered = filterSites(sites, query, workspace);
  return (
    <section className="directory" aria-label="Sites">
      {!compact && (
        <div className="directory-toolbar">
          <label className="filter-label search-field">
            Search sites
            <input
              type="search"
              placeholder="Search by name or hostname…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <WorkspaceFilter
            organizations={organizations}
            value={workspace}
            onChange={setWorkspace}
          />
          <span className="muted" role="status">
            {filtered.length} sites
          </span>
        </div>
      )}
      {!filtered.length ? (
        <div className="empty-state">
          <span className="empty-illustration">
            <Icon name="globe" />
          </span>
          <h2>
            {sites.length ? 'No matching sites' : 'Your sites will appear here'}
          </h2>
          <p>
            {sites.length
              ? 'Try a different name or workspace.'
              : 'Add your first site and pair the WordPress connector.'}
          </p>
          {!sites.length && (
            <Link className="button" href="/app/sites/new">
              Add your first site
            </Link>
          )}
        </div>
      ) : compact ? (
        <div className="site-card-grid">
          {filtered.map((site) => {
            const unresolved = incidents.filter(
              (incident) =>
                incident.siteId === site.id && incident.status !== 'resolved',
            ).length;
            return (
              <article className="site-overview-card" key={site.id}>
                <div className="site-card-heading">
                  <span className="icon-tile tone-info">
                    <Icon name="globe" />
                  </span>
                  <StatusBadge status={site.status} />
                </div>
                <Link className="site-name" href={`/app/sites/${site.id}`}>
                  {site.name}
                </Link>
                <p className="site-card-host">{site.hostname}</p>
                <span className="workspace-label">
                  <Icon name="workspace" />
                  {
                    organizations.find(
                      (organization) => organization.id === site.organizationId,
                    )?.name
                  }
                </span>
                <dl className="site-card-facts">
                  <div>
                    <dt>
                      <Icon name="clock" /> Last heartbeat
                    </dt>
                    <dd>
                      <Timestamp value={site.lastSeenAt} />
                    </dd>
                  </div>
                  <div>
                    <dt>
                      <Icon name="alert" /> Recent unresolved
                    </dt>
                    <dd>{unresolved}</dd>
                  </div>
                </dl>
                <div className="row-actions">
                  <Link href={`/app/sites/${site.id}?view=monitoring`}>
                    <Icon name="pulse" /> Monitoring
                  </Link>
                  <Link href={`/app/sites/${site.id}?view=inventory`}>
                    <Icon name="inventory" /> Inventory
                  </Link>
                  <Link href={`/app/sites/${site.id}?view=connection`}>
                    <Icon name="connection" /> Connection
                  </Link>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th scope="col">Site / workspace</th>
                <th scope="col">Connector</th>
                <th scope="col">Last heartbeat</th>
                <th scope="col">Recent unresolved</th>
                <th scope="col">Quick access</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((site) => (
                <tr key={site.id}>
                  <td data-label="Site / workspace">
                    <Link className="site-name" href={`/app/sites/${site.id}`}>
                      {site.name}
                    </Link>
                    <span className="table-subtitle">
                      {site.hostname} ·{' '}
                      {
                        organizations.find(
                          (organization) =>
                            organization.id === site.organizationId,
                        )?.name
                      }
                    </span>
                  </td>
                  <td data-label="Connector">
                    <StatusBadge status={site.status} />
                  </td>
                  <td data-label="Last heartbeat">
                    <Timestamp value={site.lastSeenAt} />
                  </td>
                  <td data-label="Recent unresolved">
                    {
                      incidents.filter(
                        (incident) =>
                          incident.siteId === site.id &&
                          incident.status !== 'resolved',
                      ).length
                    }
                  </td>
                  <td data-label="Quick access">
                    <div className="row-actions">
                      <Link href={`/app/sites/${site.id}?view=monitoring`}>
                        <Icon name="pulse" />
                        Monitoring
                      </Link>
                      <Link href={`/app/sites/${site.id}?view=inventory`}>
                        <Icon name="inventory" />
                        Inventory
                      </Link>
                      <Link href={`/app/sites/${site.id}?view=connection`}>
                        <Icon name="connection" />
                        Connection
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!compact && (
        <p className="data-note">
          Up to 1,000 sites and the latest 100 incidents per workspace.
          Heartbeats measure the connector connection, not HTTP availability.
        </p>
      )}
    </section>
  );
}
export function IncidentDirectory({
  sites,
  organizations,
  incidents,
  canManage,
  compact = false,
}: DirectoryProps & { canManage: boolean }) {
  const [status, setStatus] = useState('');
  const [workspace, setWorkspace] = useState('');
  const filtered = incidents.filter(
    (incident) =>
      (!status || incident.status === status) &&
      (!workspace ||
        sites.some(
          (site) =>
            site.id === incident.siteId && site.organizationId === workspace,
        )),
  );
  return (
    <section className="directory" aria-label="Incidents">
      {!compact && (
        <div className="directory-toolbar">
          <label className="filter-label">
            Status
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              <option value="">All statuses</option>
              <option value="open">Open</option>
              <option value="acknowledged">Acknowledged</option>
              <option value="resolved">Resolved</option>
            </select>
          </label>
          <WorkspaceFilter
            organizations={organizations}
            value={workspace}
            onChange={setWorkspace}
          />
          <span className="muted" role="status">
            {filtered.length} incidents
          </span>
        </div>
      )}
      {!filtered.length ? (
        <div className="empty-state">
          <span className="empty-illustration">
            <Icon name="shield" />
          </span>
          <h2>No incidents to show</h2>
          <p>
            {incidents.length
              ? 'Try another filter.'
              : 'Incidents appear here when monitoring confirms a problem.'}
          </p>
        </div>
      ) : (
        <div className="table-scroll">
          <table>
            <caption className="incident-caption">
              Event states describe each incident, not current site
              availability.
            </caption>
            <thead>
              <tr>
                <th scope="col">Site / monitor</th>
                <th scope="col">Event state</th>
                <th scope="col">Status</th>
                <th scope="col">Severity</th>
                <th scope="col">Started</th>
                <th scope="col">Action</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((incident) => {
                const site = sites.find(
                  (entry) => entry.id === incident.siteId,
                );
                const organization = organizations.find(
                  (entry) => entry.id === site?.organizationId,
                );
                return (
                  <tr key={incident.id}>
                    <td data-label="Site / monitor">
                      <Link
                        className="site-name"
                        href={`/app/sites/${incident.siteId}?view=monitoring`}
                      >
                        {site?.name ?? 'View site'}
                      </Link>
                      <span className="table-subtitle">
                        {incident.monitorType === 'uptime'
                          ? 'HTTP availability'
                          : 'SSL certificate'}{' '}
                        · {organization?.name}
                      </span>
                    </td>
                    <td data-label="Event state">
                      <IncidentSignal incident={incident} />
                    </td>
                    <td data-label="Status">
                      <StatusBadge status={incident.status} />
                    </td>
                    <td data-label="Severity">
                      <StatusBadge status={incident.severity} />
                    </td>
                    <td data-label="Started">
                      <Timestamp value={incident.startedAt} />
                    </td>
                    <td data-label="Action">
                      {canManage &&
                      organization &&
                      organization.role !== 'member' &&
                      incident.status === 'open' ? (
                        <IncidentAction
                          siteId={incident.siteId}
                          incidentId={incident.id}
                        />
                      ) : (
                        <Link
                          href={`/app/sites/${incident.siteId}?view=monitoring`}
                        >
                          View details →
                        </Link>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
export function AddSiteForm({
  organizations,
  usages,
}: {
  organizations: Organization[];
  usages: Record<string, import('@sitepulse/api-contracts').OrganizationUsage>;
}) {
  const router = useRouter();
  const [organizationId, setOrganizationId] = useState(
    organizations[0]?.id ?? '',
  );
  const usage = usages[organizationId];
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError('');
    const data = new FormData(event.currentTarget);
    try {
      const result = await api<{ site: Site }>(
        `/organizations/${data.get('organizationId')}/sites`,
        { name: data.get('name'), canonicalUrl: data.get('canonicalUrl') },
      );
      router.push(`/app/sites/${result.site.id}?view=connection`);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to add site.');
    } finally {
      setPending(false);
    }
  }
  return (
    <form className="creation-form" onSubmit={submit}>
      <label htmlFor="workspace">Workspace</label>
      <select
        id="workspace"
        name="organizationId"
        required
        value={organizationId}
        onChange={(event) => {
          setOrganizationId(event.target.value);
          setError('');
        }}
      >
        {organizations.map((organization) => (
          <option key={organization.id} value={organization.id}>
            {organization.name}
          </option>
        ))}
      </select>
      {usage && <PlanUsage usage={usage} />}
      <label htmlFor="name">Site name</label>
      <input
        id="name"
        name="name"
        maxLength={100}
        required
        placeholder="My WordPress site"
      />
      <label htmlFor="url">Public site URL</label>
      <input
        id="url"
        name="canonicalUrl"
        type="url"
        maxLength={2048}
        required
        placeholder="https://example.com"
      />
      <p className="muted">
        After adding the site, generate a pairing code to connect WordPress.
      </p>
      {error && <p role="alert">{error}</p>}
      <div className="row-actions">
        <button disabled={pending || !usage?.canAddSite}>
          {pending ? 'Adding site…' : 'Add and connect site'}
        </button>
        <Link href="/app/sites">Cancel</Link>
      </div>
    </form>
  );
}
