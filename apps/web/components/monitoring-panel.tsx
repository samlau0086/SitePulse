import type {
  Incident,
  MonitorCheck,
  MonitorState,
} from '@sitepulse/api-contracts';
import { IncidentAction } from './incident-action';

const labels: Record<MonitorState['state'], string> = {
  pending: 'Awaiting first check',
  healthy: 'Healthy',
  suspected: 'Suspected failure — awaiting confirmation',
  down: 'Down',
  recovering: 'Recovering — awaiting confirmation',
  warning: 'Certificate warning',
};
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
  return (
    <>
      <section className="card">
        <h2>External monitoring</h2>
        <p>
          HTTP availability and certificate health are checked independently of
          connector heartbeats. Reload for the latest results.
        </p>
        {!monitoring.length && (
          <p>
            Monitoring starts after pairing when the worker is enabled.
            Disconnected sites are not checked.
          </p>
        )}
        {monitoring.map((monitor) => {
          const latest = checks.find(
            (check) => check.monitorType === monitor.monitorType,
          );
          return (
            <div className="monitor-summary" key={monitor.monitorType}>
              <h3>
                {monitor.monitorType === 'uptime'
                  ? 'HTTP availability'
                  : 'SSL certificate'}
                : {labels[monitor.state]}
              </h3>
              <p>
                Last check:{' '}
                {monitor.lastCheckedAt
                  ? new Date(monitor.lastCheckedAt).toISOString()
                  : 'Not checked'}{' '}
                · Next scheduled: {new Date(monitor.nextRunAt).toISOString()}
              </p>
              {latest && (
                <p>
                  Result: {latest.result}
                  {latest.httpStatus !== null && ` · HTTP ${latest.httpStatus}`}
                  {latest.latencyMs !== null && ` · ${latest.latencyMs} ms`}
                  {latest.errorCode && ` · ${latest.errorCode}`}
                </p>
              )}
              {latest?.sslExpiresAt && (
                <p>
                  Certificate expires:{' '}
                  {new Date(latest.sslExpiresAt).toISOString()}
                </p>
              )}
            </div>
          );
        })}
        {!https && <p>SSL checks require a registered HTTPS site URL.</p>}
        <h3>Recent checks</h3>
        {!checks.length ? (
          <p>No checks recorded yet.</p>
        ) : (
          <ul>
            {checks.slice(0, 20).map((check) => (
              <li key={check.id}>
                {new Date(check.checkedAt).toISOString()} · {check.monitorType}{' '}
                · {check.result}
                {check.httpStatus !== null && ` · HTTP ${check.httpStatus}`}
                {check.errorCode && ` · ${check.errorCode}`}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="card">
        <h2>Incident history</h2>
        <p>
          Two consecutive failures confirm an incident; two consecutive
          successes confirm recovery. Acknowledging an incident does not stop
          checks or mark it recovered.
        </p>
        {!incidents.length ? (
          <p>No incidents recorded.</p>
        ) : (
          <ul>
            {incidents.map((incident) => (
              <li key={incident.id}>
                <p>
                  {incident.monitorType} · {incident.severity} ·{' '}
                  {incident.status} · Started{' '}
                  {new Date(incident.startedAt).toISOString()}
                  {incident.resolvedAt &&
                    ` · Closed ${new Date(incident.resolvedAt).toISOString()} (${incident.resolutionReason === 'connection_reset' ? 'connection reset' : 'recovered'})`}
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
      </section>
    </>
  );
}
