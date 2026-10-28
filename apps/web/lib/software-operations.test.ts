import { expect, it, vi } from 'vitest';
import type {
  InstalledComponent,
  SoftwareDirectory,
  SoftwareOperation,
} from '@sitepulse/api-contracts';
import {
  actionable,
  assertUnchangedTargets,
  executeSoftwarePlans,
  planOperations,
  type SoftwarePreviewResult,
} from './software-operations';

const component = (identifier: string, active = false): InstalledComponent => ({
  identifier,
  name: identifier,
  active,
  version: '1.0',
  updateVersion: '2.0',
  source: 'wordpress.org',
});
function directory(): SoftwareDirectory {
  return {
    canManage: true,
    operations: [],
    sites: [
      {
        id: 'site-a',
        name: 'Site A',
        canonicalUrl: 'https://a.example.test',
        enabled: true,
        polledAt: '2026-10-28T00:00:00Z',
        inventoryAt: '2026-10-28T00:00:00Z',
        canSync: true,
        inventorySync: {
          status: 'succeeded',
          requestedAt: null,
          attemptedAt: null,
          error: null,
        },
        plugins: [
          component('alpha'),
          component('beta'),
          component('sitepulse-connector', true),
        ],
        themes: [component('theme-one', true), component('theme-two')],
      },
      {
        id: 'site-b',
        name: 'Site B',
        canonicalUrl: 'https://b.example.test',
        enabled: true,
        polledAt: '2026-10-28T00:00:00Z',
        inventoryAt: '2026-10-28T00:00:00Z',
        canSync: true,
        inventorySync: {
          status: 'succeeded',
          requestedAt: null,
          attemptedAt: null,
          error: null,
        },
        plugins: [component('alpha', true)],
        themes: [],
      },
    ],
  };
}
function fixtures() {
  const initial = directory();
  const plans = planOperations(initial.sites, 'plugin', 'activate', [
    'alpha',
    'beta',
  ]);
  const previews: SoftwarePreviewResult[] = plans.map((plan, index) => ({
    batchId: `batch-${index}`,
    command: plan.command,
    impact: plan.targets.map(({ siteId, name }) => ({ siteId, name })),
    warning: 'Back up first',
  }));
  const done = structuredClone(initial);
  done.sites[0]!.inventoryAt = '2026-10-28T00:01:00Z';
  done.sites[0]!.plugins[0]!.active = true;
  done.operations = [
    {
      ...plans[0]!.command,
      id: 'op-a',
      batchId: 'batch-0',
      siteId: 'site-a',
      siteName: 'Site A',
      status: 'succeeded',
      resultCode: 'ok',
      reason: 'Maintenance',
      createdAt: initial.sites[0]!.inventoryAt!,
    },
  ];
  let reads = 0;
  const request = vi.fn(
    async (
      path: string,
      _body?: unknown,
      method?: string,
    ): Promise<unknown> => {
      if (method === 'GET') return reads++ === 0 ? initial : done;
      if (path.endsWith('/preview'))
        return { ...previews[1], batchId: 'fresh-beta' };
      return { success: true };
    },
  );
  const options = {
    base: '/software',
    plans,
    previews,
    reason: 'Maintenance',
    signal: new AbortController().signal,
    request: request as Parameters<typeof executeSoftwarePlans>[0]['request'],
    onDirectory: vi.fn(),
    onProgress: vi.fn(),
    wait: vi.fn(async () => {}),
  };
  return { initial, plans, previews, done, request, options };
}
it('selects exact installed eligible targets and protects active/custom/connector items', () => {
  const data = directory();
  expect(
    planOperations(data.sites, 'plugin', 'activate', [
      'alpha',
      'alpha',
      'missing',
    ])[0]!.targets.map((target) => target.siteId),
  ).toEqual(['site-a']);
  expect(
    planOperations(data.sites, 'plugin', 'deactivate', [
      'alpha',
    ])[0]!.targets.map((target) => target.siteId),
  ).toEqual(['site-b']);
  expect(
    planOperations(data.sites, 'plugin', 'uninstall', ['sitepulse-connector']),
  ).toEqual([]);
  expect(actionable(component('alpha', true), 'uninstall')).toBe(false);
  expect(
    actionable({ ...component('alpha'), source: 'custom' }, 'update'),
  ).toBe(false);
  expect(
    actionable({ ...component('alpha'), updateVersion: null }, 'update'),
  ).toBe(false);
  expect(
    planOperations(data.sites, 'theme', 'deactivate', ['theme-one'])[0]!.command
      .kind,
  ).toBe('theme');
  expect(
    planOperations(data.sites, 'plugin', 'install', [
      'alpha',
      'new-plugin',
    ]).map((plan) => plan.command.slug),
  ).toEqual(['new-plugin']);
});
it('submits direct actions exactly once without adding other components or sites', async () => {
  const { options, request } = fixtures();
  await executeSoftwarePlans({
    ...options,
    plans: [options.plans[0]!],
    previews: [options.previews[0]!],
  });
  expect(request.mock.calls.map(([path]) => path)).toEqual([
    '/software',
    '/software/batch-0/confirm',
  ]);
});
it('excludes management-disabled sites without blocking other eligible targets', () => {
  const data = directory();
  data.sites[0]!.enabled = false;
  expect(
    planOperations(data.sites, 'plugin', 'activate', ['alpha', 'beta']),
  ).toEqual([]);
  expect(
    planOperations(data.sites, 'plugin', 'install', [
      'new-plugin',
    ])[0]!.targets.map((target) => target.siteId),
  ).toEqual(['site-b']);
});
it('stops when results disappear or success never receives fresh inventory', async () => {
  const missing = fixtures();
  missing.done.operations = [];
  await expect(executeSoftwarePlans(missing.options)).rejects.toThrow(
    'no longer visible',
  );
  expect(
    missing.request.mock.calls.filter(([path]) => path.endsWith('/confirm')),
  ).toHaveLength(1);
  const stale = fixtures();
  stale.done.sites[0]!.inventoryAt = stale.initial.sites[0]!.inventoryAt;
  const clock = vi
    .spyOn(Date, 'now')
    .mockReturnValueOnce(0)
    .mockReturnValue(76 * 60_000);
  try {
    await expect(executeSoftwarePlans(stale.options)).rejects.toThrow(
      'waiting for results or fresh inventory',
    );
    expect(
      stale.request.mock.calls.filter(([path]) => path.endsWith('/confirm')),
    ).toHaveLength(1);
  } finally {
    clock.mockRestore();
  }
});
it('waits for success AND new inventory then revalidates and confirms the next immutable command', async () => {
  const { options, request, done, initial } = fixtures();
  const stale = structuredClone(done);
  stale.sites[0]!.inventoryAt = initial.sites[0]!.inventoryAt;
  request
    .mockImplementationOnce(async () => initial)
    .mockImplementationOnce(async () => ({ success: true }))
    .mockImplementationOnce(async () => stale)
    .mockImplementationOnce(async () => done);
  await executeSoftwarePlans(options);
  expect(options.wait).toHaveBeenCalledTimes(2);
  expect(
    request.mock.calls
      .filter(([path]) => path.endsWith('/confirm'))
      .map(([path]) => path),
  ).toEqual(['/software/batch-0/confirm', '/software/fresh-beta/confirm']);
  expect(request).toHaveBeenCalledWith('/software/preview', {
    siteIds: ['site-a'],
    command: { kind: 'plugin', action: 'activate', slug: 'beta' },
    reason: 'Maintenance',
  });
});
it.each([
  'failed',
  'unknown',
  'cancelled',
  'expired',
] as SoftwareOperation['status'][])(
  'stops after %s without retry or next submission',
  async (status) => {
    const { options, done, request } = fixtures();
    done.operations[0]!.status = status;
    await expect(executeSoftwarePlans(options)).rejects.toThrow(
      'Stopped remaining',
    );
    expect(
      request.mock.calls.filter(([path]) => path.endsWith('/confirm')),
    ).toHaveLength(1);
    expect(request.mock.calls.some(([path]) => path.endsWith('/preview'))).toBe(
      false,
    );
  },
);
it('stops when the next target changed, visibility is lost, or authorization is removed', async () => {
  const { options, done, request } = fixtures();
  done.sites[0]!.plugins[1]!.version = 'external-change';
  await expect(executeSoftwarePlans(options)).rejects.toThrow('target changed');
  expect(
    request.mock.calls.filter(([path]) => path.endsWith('/confirm')),
  ).toHaveLength(1);
  const { plans, initial } = fixtures();
  initial.canManage = false;
  expect(() => assertUnchangedTargets(plans[0]!, initial)).toThrow(
    'target changed',
  );
  initial.canManage = true;
  initial.sites[0]!.enabled = false;
  expect(() => assertUnchangedTargets(plans[0]!, initial)).toThrow(
    'target changed',
  );
});
it('does not retry a lost confirmation response or submit remaining items after abort', async () => {
  const { options, request } = fixtures();
  request
    .mockImplementationOnce(async () => directory())
    .mockRejectedValueOnce(new Error('Network response lost'));
  await expect(executeSoftwarePlans(options)).rejects.toThrow(
    'Network response lost',
  );
  expect(
    request.mock.calls.filter(([path]) => path.endsWith('/confirm')),
  ).toHaveLength(1);
  const next = fixtures();
  const controller = new AbortController();
  next.options.signal = controller.signal;
  next.options.wait = vi.fn(async () => {
    controller.abort();
  });
  await expect(executeSoftwarePlans(next.options)).rejects.toThrow(
    'Already submitted commands may still execute',
  );
  expect(
    next.request.mock.calls.filter(([path]) => path.endsWith('/confirm')),
  ).toHaveLength(1);
});
