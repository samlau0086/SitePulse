import type { Incident } from '@sitepulse/api-contracts';
import { Icon, type IconName } from './icon';

export function IncidentSignal({ incident }: { incident: Incident }) {
  let label: string;
  let description: string;
  let tone: 'success' | 'danger' | 'warning' | 'info';
  let icon: IconName;

  if (incident.status === 'resolved') {
    if (incident.resolutionReason === 'recovered' && incident.resolvedAt) {
      label =
        incident.monitorType === 'uptime'
          ? 'UP'
          : incident.monitorType === 'stale_data'
            ? 'Connector restored'
            : 'Certificate recovered';
      description = 'Recovered in this incident';
      tone = 'success';
      icon =
        incident.monitorType === 'uptime'
          ? 'up'
          : incident.monitorType === 'stale_data'
            ? 'connection'
            : 'shield';
    } else {
      label = 'Closed';
      description =
        incident.resolutionReason === 'connection_reset'
          ? 'Connection reset · recovery unverified'
          : 'Recovery unverified';
      tone = 'info';
      icon = 'info';
    }
  } else if (incident.monitorType === 'uptime') {
    label = 'DOWN';
    description = 'Awaiting confirmed recovery';
    tone = 'danger';
    icon = 'down';
  } else if (incident.monitorType === 'stale_data') {
    label = 'Connector offline';
    description = 'Heartbeat overdue · website availability is independent';
    tone = 'warning';
    icon = 'connection';
  } else {
    label =
      incident.severity === 'warning'
        ? 'Certificate warning'
        : 'Certificate issue';
    description = 'SSL monitor';
    tone = incident.severity === 'warning' ? 'warning' : 'danger';
    icon = 'shield';
  }

  return (
    <span className="incident-signal">
      <span className={`incident-signal-icon tone-${tone}`}>
        <Icon name={icon} />
      </span>
      <span>
        <strong>{label}</strong>
        <span className="table-subtitle">{description}</span>
      </span>
    </span>
  );
}
