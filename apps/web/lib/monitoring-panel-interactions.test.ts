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
          incidents: Array.from({ length: 7 }, (_, index) => ({
            id: `incident-${index}`,
            siteId: 'a',
            monitorType: 'uptime' as const,
            status: 'open' as const,
            severity: 'critical' as const,
            startedAt: '2026-10-28T00:00:00Z',
            resolvedAt: null,
            resolutionReason: null,
          })),
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
    await act(async () =>
      Array.from(host.querySelectorAll('button'))
        .find((button) => button.textContent === 'Next')!
        .click(),
    );
    expect(host.textContent).toContain('6–7 of 7 loaded records');
    const filter = host.querySelector('.monitor-incident-filter')!;
    expect(filter.querySelector('legend')?.textContent).toBe('Show incidents');
    expect(filter.querySelector('select')).toBeNull();
    const buttons = Array.from(filter.querySelectorAll('button'));
    expect(buttons.map((button) => button.textContent)).toEqual([
      'All statuses',
      'Active',
      'Resolved',
    ]);
    expect(buttons[0]?.getAttribute('aria-pressed')).toBe('true');
    await act(async () => buttons[2]!.click());
    expect(buttons[2]?.getAttribute('aria-pressed')).toBe('true');
    expect(buttons[0]?.getAttribute('aria-pressed')).toBe('false');
    expect(host.textContent).toContain('No incidents match this filter');
    await act(async () => buttons[1]!.click());
    expect(host.textContent).toContain('Awaiting confirmed recovery');
    expect(host.textContent).toContain('1–5 of 7 loaded records');
    expect(buttons[1]?.getAttribute('aria-pressed')).toBe('true');
    expect(buttons[2]?.getAttribute('aria-pressed')).toBe('false');
    await act(async () => buttons[0]!.click());
    expect(host.textContent).toContain('1–5 of 7 loaded records');
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
