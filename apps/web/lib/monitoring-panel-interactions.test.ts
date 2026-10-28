// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { MonitoringPanel } from '../components/monitoring-panel';

vi.mock('../components/incident-action', () => ({
  IncidentAction: () => null,
}));

it('bounds check history and supports incident navigation and filtering', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        createElement(MonitoringPanel, {
          monitoring: [],
          https: true,
          canManage: false,
          checks: Array.from({ length: 12 }, (_, index) => ({
            id: `check-${index}`,
            siteId: 'a',
            monitorType: 'uptime' as const,
            checkedAt: new Date(Date.UTC(2026, 9, 28, 0, index)).toISOString(),
            result: 'down' as const,
            httpStatus: 500,
            latencyMs: index,
            sslExpiresAt: null,
            errorCode: null,
          })),
          incidents: [
            {
              id: 'incident',
              siteId: 'a',
              monitorType: 'uptime',
              status: 'open',
              severity: 'critical',
              startedAt: '2026-10-28T00:00:00Z',
              resolvedAt: null,
              resolutionReason: null,
            },
          ],
        }),
      ),
    );
    expect(host.querySelectorAll('tbody tr')).toHaveLength(5);
    expect(host.textContent).toContain('1–5 of 12');
    await act(async () =>
      Array.from(host.querySelectorAll('button'))
        .find((button) => button.textContent === 'Next')!
        .click(),
    );
    expect(host.textContent).toContain('6–10 of 12');
    await act(async () =>
      Array.from(host.querySelectorAll('button'))
        .find((button) => button.textContent?.includes('Incidents ('))!
        .click(),
    );
    expect(host.textContent).toContain('Awaiting confirmed recovery');
    const filter = host.querySelector('select')!;
    await act(async () => {
      filter.value = 'resolved';
      filter.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(host.textContent).toContain('No incidents match this filter');
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
