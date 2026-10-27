import Link from 'next/link';
import type { Site } from '@sitepulse/api-contracts';
import { Icon } from './icon';

export function ConnectionSummary({
  sites,
  unresolved,
}: {
  sites: Site[];
  unresolved: number;
}) {
  const groups = [
    { status: 'active', label: 'Active', tone: 'success' },
    { status: 'degraded', label: 'Stale heartbeat', tone: 'warning' },
    { status: 'pending', label: 'Awaiting pairing', tone: 'info' },
    { status: 'disconnected', label: 'Disconnected', tone: 'neutral' },
  ].map((group) => ({
    ...group,
    count: sites.filter((site) => site.status === group.status).length,
  }));
  const active = groups[0]!.count;
  const stale = groups[1]!.count;
  const unpaired = groups[2]!.count + groups[3]!.count;
  let offset = 0;
  return (
    <div className="overview-panels">
      <section
        className="overview-panel"
        aria-labelledby="connection-summary-title"
      >
        <h2 id="connection-summary-title">
          <Icon name="connection" /> Connector activity
        </h2>
        <div className="connection-visual">
          <div className="connection-ring">
            <svg viewBox="0 0 120 120" aria-hidden="true" focusable="false">
              <circle className="ring-track" cx="60" cy="60" r="48" />
              {groups.map((group) => {
                const length = sites.length
                  ? (group.count / sites.length) * 100
                  : 0;
                const start = offset;
                offset += length;
                return (
                  <circle
                    key={group.status}
                    className={`ring-segment tone-${group.tone}`}
                    cx="60"
                    cy="60"
                    r="48"
                    pathLength="100"
                    strokeDasharray={`${length} ${100 - length}`}
                    strokeDashoffset={-start}
                    transform="rotate(-90 60 60)"
                  />
                );
              })}
            </svg>
            <div>
              <strong>
                {active}
                <span> / {sites.length}</span>
              </strong>
              <span>active</span>
            </div>
          </div>
          <ul className="connection-legend">
            {groups.map((group) => (
              <li key={group.status}>
                <span
                  className={`legend-dot tone-${group.tone}`}
                  aria-hidden="true"
                />
                <span>{group.label}</span>
                <strong>{group.count}</strong>
              </li>
            ))}
          </ul>
        </div>
        <p className="data-note">
          Connector activity is separate from HTTP availability.
        </p>
      </section>
      <section
        className="overview-panel attention-panel"
        aria-labelledby="attention-title"
      >
        <h2 id="attention-title">
          <Icon name="alert" /> What needs your attention
        </h2>
        {stale > 0 && (
          <Link className="attention-item" href="/app/sites">
            <span className="icon-tile tone-warning">
              <Icon name="clock" />
            </span>
            <span>
              <strong>
                {stale} {stale === 1 ? 'connector needs' : 'connectors need'} a
                check
              </strong>
              <small>
                Heartbeat overdue. Open the site to review its connection.
              </small>
            </span>
            <Icon name="arrow" />
          </Link>
        )}
        {unresolved > 0 && (
          <Link className="attention-item" href="/app/incidents">
            <span className="icon-tile tone-danger">
              <Icon name="alert" />
            </span>
            <span>
              <strong>{unresolved} unresolved in recent history</strong>
              <small>
                Review the latest incidents and their monitoring details.
              </small>
            </span>
            <Icon name="arrow" />
          </Link>
        )}
        {unpaired > 0 && (
          <Link className="attention-item" href="/app/sites">
            <span className="icon-tile tone-info">
              <Icon name="connection" />
            </span>
            <span>
              <strong>
                {unpaired} {unpaired === 1 ? 'site needs' : 'sites need'} a
                connection
              </strong>
              <small>Pair the connector to start receiving site data.</small>
            </span>
            <Icon name="arrow" />
          </Link>
        )}
        {stale === 0 && unresolved === 0 && unpaired === 0 && (
          <div className="attention-empty">
            <span className="icon-tile tone-success">
              <Icon name={sites.length ? 'check' : 'globe'} />
            </span>
            <strong>
              {sites.length
                ? 'No connection issues or recent unresolved incidents'
                : 'Start with your first website'}
            </strong>
            <p>
              {sites.length
                ? 'Review individual monitors for HTTP and SSL health.'
                : 'Add a site, then pair its WordPress connector.'}
            </p>
            <Link href={sites.length ? '/app/sites' : '/app/sites/new'}>
              {sites.length ? 'Explore your sites' : 'Add a site'}{' '}
              <Icon name="arrow" />
            </Link>
          </div>
        )}
      </section>
    </div>
  );
}
