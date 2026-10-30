// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import type { SitePerformance } from '@sitepulse/api-contracts';
import { PerformancePanel } from '../components/performance-panel';
vi.mock('../components/user-preferences', () => ({
  Timestamp: ({ value }: { value: string | null }) => value ?? 'Not received',
}));
const initial: SitePerformance = {
  enabled: true,
  available: true,
  canRefresh: true,
  refreshAfter: null,
  devices: [
    {
      strategy: 'mobile',
      state: 'pending',
      lastAttemptAt: null,
      nextRunAt: null,
      errorCode: null,
      report: null,
    },
  ],
  history: [],
};
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it('queues a refresh, reloads with GET and polls queued work', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const queued = {
    ...initial,
    canRefresh: false,
    devices: [{ ...initial.devices[0]!, state: 'queued' }],
  };
  const request = vi
    .fn()
    .mockImplementation(async (_url: string, options: RequestInit) =>
      Response.json(
        options.method === 'POST' ? { queued: true } : { performance: queued },
      ),
    );
  vi.stubGlobal('fetch', request);
  const host = document.createElement('div');
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        createElement(PerformancePanel, {
          siteId: 'fixture',
          initial,
          canManage: true,
        }),
      ),
    );
    expect(host.textContent).toContain('No score');
    await act(async () => host.querySelector('button')!.click());
    expect(request.mock.calls.map((c) => c[1].method)).toEqual(['POST', 'GET']);
    expect(host.textContent).toContain('Both device checks are queued');
    expect(host.querySelector('button')!.disabled).toBe(true);
    await act(async () => vi.advanceTimersByTimeAsync(10000));
    expect(request.mock.calls[2]![1].method).toBe('GET');
  } finally {
    await act(async () => root.unmount());
  }
});
it('disables member mutations and paginates history without treating zero as missing', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div');
  const root = createRoot(host);
  const history = Array.from({ length: 7 }, (_, i) => ({
    id: String(i),
    strategy: 'mobile' as const,
    checkedAt: '2026-10-30T00:00:00Z',
    completedAt: '2026-10-30T00:01:00Z',
    score: 0,
    errorCode: null,
  }));
  try {
    await act(async () =>
      root.render(
        createElement(PerformancePanel, {
          siteId: 'fixture',
          initial: { ...initial, enabled: false, history },
          canManage: false,
        }),
      ),
    );
    expect(host.querySelector('button')!.disabled).toBe(true);
    expect(host.textContent).toContain('administrator must configure');
    expect(host.querySelectorAll('tbody tr')).toHaveLength(5);
    expect(host.textContent).toContain('0/100');
    await act(async () =>
      Array.from(host.querySelectorAll('button'))
        .find((b) => b.textContent === 'Next')!
        .click(),
    );
    expect(host.querySelectorAll('tbody tr')).toHaveLength(2);
  } finally {
    await act(async () => root.unmount());
  }
});
