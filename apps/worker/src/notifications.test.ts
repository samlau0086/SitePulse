import { expect, it } from 'vitest';
import { incidentMail } from './notifications';

const delivery = {
  eventType: 'opened',
  monitorType: 'stale_data',
  siteName: 'Fixture WP',
  siteUrl: 'https://fixture.example',
  severity: 'warning',
} as const;
it('explains connector loss independently of public availability', () => {
  const mail = incidentMail(delivery, 'https://pulse.example');
  expect(mail.subject).toContain('Connector offline');
  expect(mail.text).toContain('not an HTTP downtime alert');
  expect(mail.text).toContain('https://pulse.example/app/incidents');
});
it('only claims connector restoration on a heartbeat recovery', () => {
  const mail = incidentMail(
    { ...delivery, eventType: 'recovered' },
    'https://pulse.example',
  );
  expect(mail.subject).toContain('Connector restored');
  expect(mail.text).toContain('does not confirm HTTP availability');
});
it('preserves ordinary HTTP failure/recovery messaging', () => {
  expect(
    incidentMail(
      { ...delivery, monitorType: 'uptime' },
      'https://pulse.example',
    ).subject,
  ).toContain('Incident:');
  expect(
    incidentMail(
      { ...delivery, monitorType: 'uptime', eventType: 'recovered' },
      'https://pulse.example',
    ).text,
  ).toContain('has recovered');
});
