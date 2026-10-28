import { expect, it } from 'vitest';
import { directoryHealth } from './site-health';

const now = Date.now();
const probe = {
  state: 'healthy' as const,
  lastCheckedAt: new Date(now - 30_000),
  nextRunAt: new Date(now + 60 * 60_000),
};
it.each([
  ['healthy', 'up'],
  ['down', 'down'],
  ['suspected', 'suspected'],
  ['recovering', 'recovering'],
  ['pending', 'pending'],
  ['warning', 'pending'],
] as const)(
  'maps HTTP %s to %s independently of Connector health',
  (state, expected) => {
    for (const status of ['active', 'degraded'] as const)
      expect(
        directoryHealth({ status }, null, null, { ...probe, state }, now)
          .availability.state,
      ).toBe(expected);
  },
);
it('does not report UP for absent, untested, disabled or overdue probes', () => {
  expect(
    directoryHealth({ status: 'active' }, null, null, null, now).availability
      .state,
  ).toBe('pending');
  expect(
    directoryHealth(
      { status: 'active' },
      null,
      null,
      { ...probe, lastCheckedAt: null },
      now,
    ).availability.state,
  ).toBe('pending');
  expect(
    directoryHealth({ status: 'disconnected' }, null, null, probe, now)
      .availability.state,
  ).toBe('disabled');
  expect(
    directoryHealth(
      { status: 'active' },
      null,
      null,
      { ...probe, nextRunAt: new Date(now - 6 * 60_000) },
      now,
    ).availability.state,
  ).toBe('stale');
  // A valid 60-minute schedule must not expire after five minutes.
  expect(
    directoryHealth(
      { status: 'active' },
      null,
      null,
      { ...probe, lastCheckedAt: new Date(now - 59 * 60_000) },
      now,
    ).availability.state,
  ).toBe('up');
});
it('reports unknown security coverage instead of a clean assessment when absent', () => {
  expect(
    directoryHealth({ status: 'active' }, null, null, probe, now).security,
  ).toEqual({
    status: 'pending',
    coverage: {
      inventory: 'unknown',
      localFiles: 'unknown',
      publicVulnerabilities: 'unknown',
    },
    checkedAt: null,
    highestSeverity: null,
    environmentRisks: 0,
    vulnerabilities: 0,
    localIndicators: 0,
  });
});
