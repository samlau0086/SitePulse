'use client';

import { useState } from 'react';
import { Icon } from './icon';
import type {
  Incident,
  MonitorCheck,
  MonitorState,
} from '@sitepulse/api-contracts';
import { IncidentAction } from './incident-action';
import { IncidentSignal } from './incident-signal';
import { Timestamp } from './user-preferences';

const labels: Record<MonitorState['state'], string> = {
  pending: 'Awaiting first check',
  healthy: 'Healthy',
  suspected: 'First failure — awaiting confirmation',
  down: 'Confirmed down',
  recovering: 'Recovering — awaiting confirmation',
  warning: 'Certificate warning',
};
function Pagination({
  page,
  total,
  onChange,
}: {
  page: number;
  total: number;
  onChange: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / 5));
  return (
    <div className="monitor-pagination">
      <span aria-live="polite">
        {total
          ? `${page * 5 + 1}–${Math.min(total, (page + 1) * 5)} of ${total} loaded records`
          : 'No records'}
      </span>
      <button
        className="secondary"
        disabled={page === 0}
        onClick={() => onChange(page - 1)}
      >
        Previous
      </button>
      <button
        className="secondary"
        disabled={page + 1 >= pages}
        onClick={() => onChange(page + 1)}
      >
        Next
      </button>
    </div>
  );
}
export function MonitoringPanel({
  monitoring,
  checks,
  incidents,
  https,
  canManage,
}: {
  monitoring: MonitorState[];
  checks: MonitorCheck[];
  incidents: Incident[];
  https: boolean;
  canManage: boolean;
}) {
  const [checkPage, setCheckPage] = useState(0);
  const [incidentPage, setIncidentPage] = useState(0);
  const [history, setHistory] = useState<'checks' | 'incidents'>(
    checks.length ? 'checks' : 'incidents',
  );
  const [incidentFilter, setIncidentFilter] = useState('all');
  const filteredIncidents = incidents.filter(
    (incident) =>
      incidentFilter === 'all' ||
      (incidentFilter === 'active'
        ? incident.status !== 'resolved'
        : incident.status === 'resolved'),
  );
  const orderedChecks = [...checks].sort(
    (a, b) => Date.parse(b.checkedAt) - Date.parse(a.checkedAt),
  );
  const orderedIncidents = [...filteredIncidents].sort(
    (a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt),
  );
  return (
    <>
      <section className="card monitoring-panel">
        <h2>
          <Icon name="pulse" /> External monitoring
        </h2>
        <p className="data-note">
          HTTP availability and certificate health are checked independently of
          connector heartbeats. Reload for the latest results.
        </p>
        {!monitoring.length && (
          <p>
            Monitoring starts after pairing when the worker is enabled.
            Disconnected sites are not checked.
          </p>
        )}
        <div className="monitor-status-grid">
          {monitoring.map((monitor) => {
            const latest = orderedChecks.find(
              (check) => check.monitorType === monitor.monitorType,
            );
            return (
              <div
                className={`monitor-status-card ${monitor.state === 'healthy' ? 'tone-success' : monitor.state === 'down' ? 'tone-danger' : 'tone-warning'}`}
                key={monitor.monitorType}
              >
                <Icon
                  name={monitor.monitorType === 'uptime' ? 'globe' : 'shield'}
                />
                <h3>
                  {monitor.monitorType === 'uptime'
                    ? 'HTTP availability'
                    : 'SSL certificate'}
                </h3>
                <strong className="monitor-status-value">
                  {labels[monitor.state]}
                </strong>
                <p>
                  Last check:{' '}
                  {monitor.lastCheckedAt ? (
                    <Timestamp value={monitor.lastCheckedAt} />
                  ) : (
                    'Not checked'
                  )}{' '}
                  · Next scheduled: <Timestamp value={monitor.nextRunAt} />
                </p>
                {latest && (
                  <p>
                    Result: {latest.result}
                    {latest.httpStatus !== null &&
                      ` · HTTP ${latest.httpStatus}`}
                    {latest.latencyMs !== null && ` · ${latest.latencyMs} ms`}
                    {latest.errorCode && ` · ${latest.errorCode}`}
                  </p>
                )}
                {latest?.sslExpiresAt && (
                  <p>
                    Certificate expires:{' '}
                    <Timestamp value={latest.sslExpiresAt} />
                  </p>
                )}
              </div>
            );
          })}
        </div>
        {!https && <p>SSL checks require a registered HTTPS site URL.</p>}
      </section>
      <section className="card monitoring-panel">
        <div className="site-tabs" aria-label="Monitoring records">
          <button
            className="secondary"
            aria-pressed={history === 'checks'}
            onClick={() => setHistory('checks')}
          >
            <Icon name="clock" /> Recent checks ({checks.length})
          </button>
          <button
            className="secondary"
            aria-pressed={history === 'incidents'}
            onClick={() => setHistory('incidents')}
          >
            <Icon name="alert" /> Incidents (
            {
              incidents.filter((incident) => incident.status !== 'resolved')
                .length
            }{' '}
            active)
          </button>
        </div>
        {history === 'checks' ? (
          <>
            <h3>Recent checks</h3>
            {!checks.length ? (
              <p>No checks recorded yet.</p>
            ) : (
              <div className="monitor-table-wrap">
                <table className="monitor-check-table">
                  <thead>
                    <tr>
                      <th>Checked at</th>
                      <th>Monitor</th>
                      <th>Result</th>
                      <th>Response</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orderedChecks
                      .slice(checkPage * 5, (checkPage + 1) * 5)
                      .map((check) => (
                        <tr key={check.id}>
                          <td>
                            <Timestamp value={check.checkedAt} />
                          </td>
                          <td>
                            {check.monitorType === 'uptime' ? 'HTTP' : 'SSL'}
                          </td>
                          <td>
                            <span
                              className={`status-badge ${check.result === 'up' ? 'status-healthy' : check.result === 'down' ? 'status-critical' : 'status-warning'}`}
                            >
                              {check.result.toUpperCase()}
                            </span>
                          </td>
                          <td>
                            {check.httpStatus !== null &&
                              `HTTP ${check.httpStatus}`}
                            {check.latencyMs !== null &&
                              ` · ${check.latencyMs} ms`}
                            {check.errorCode && (
                              <small className="table-subtitle">
                                {check.errorCode}
                              </small>
                            )}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}
            <Pagination
              page={checkPage}
              total={checks.length}
              onChange={setCheckPage}
            />
            <p className="data-note">
              Recent stored results only, not a full uptime percentage. Refresh
              data to load the latest checks.
            </p>
          </>
        ) : (
          <>
            <h2>Incident history</h2>
            <fieldset className="monitor-incident-filter">
              <legend>Show incidents</legend>
              <div className="site-tabs">
                {(
                  [
                    ['all', 'All statuses'],
                    ['active', 'Active'],
                    ['resolved', 'Resolved'],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    className="secondary"
                    aria-pressed={incidentFilter === value}
                    onClick={() => {
                      setIncidentFilter(value);
                      setIncidentPage(0);
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </fieldset>
            <details className="monitor-explanation">
              <summary>How incidents and recovery work</summary>
              <p>
                HTTP and SSL incidents require two consecutive failures; two
                consecutive successes confirm recovery. The first failure is
                rechecked after 60 seconds. Connector alerts open when
                heartbeats expire and recover on a valid heartbeat; connector
                loss does not mean the website is down. Acknowledging an
                incident does not stop checks or mark it recovered. Event states
                describe each incident, not the site’s current availability.
              </p>
            </details>
            {!filteredIncidents.length ? (
              <p>No incidents match this filter.</p>
            ) : (
              <ul className="monitor-incidents">
                {orderedIncidents
                  .slice(incidentPage * 5, (incidentPage + 1) * 5)
                  .map((incident) => (
                    <li key={incident.id}>
                      <IncidentSignal incident={incident} />
                      <p>
                        {incident.monitorType} · {incident.severity} ·{' '}
                        {incident.status} · Started{' '}
                        <Timestamp value={incident.startedAt} />
                        {incident.resolvedAt && (
                          <>
                            {' '}
                            · Closed <Timestamp value={incident.resolvedAt} /> (
                            {incident.resolutionReason === 'connection_reset'
                              ? 'connection reset'
                              : incident.resolutionReason === 'recovered'
                                ? 'recovered'
                                : 'recovery unverified'}
                            )
                          </>
                        )}
                      </p>
                      {canManage && incident.status === 'open' && (
                        <IncidentAction
                          siteId={incident.siteId}
                          incidentId={incident.id}
                        />
                      )}
                    </li>
                  ))}
              </ul>
            )}
            <Pagination
              page={incidentPage}
              total={filteredIncidents.length}
              onChange={setIncidentPage}
            />
          </>
        )}
      </section>
    </>
  );
}
