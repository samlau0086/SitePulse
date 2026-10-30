// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type {
  InstalledComponent,
  SoftwareAttachment,
  SoftwareDirectory,
  SoftwareOperation,
} from '@sitepulse/api-contracts';
import { SoftwareManager } from '../components/software-manager';
import { api } from './api';

vi.mock('./api', () => ({ api: vi.fn() }));
const request = vi.mocked(api);
let root: Root;
let host: HTMLDivElement;
const item = (identifier: string, active = false): InstalledComponent => ({
  identifier,
  name: identifier,
  active,
  version: '1.0',
  updateVersion: '2.0',
  source: 'wordpress.org',
});
function fixture(): SoftwareDirectory {
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
          item('alpha'),
          item('beta'),
          item('sitepulse-connector', true),
        ],
        themes: [item('theme-one', true), item('theme-two')],
      },
    ],
  };
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    },
  });
  request.mockReset();
  request.mockImplementation(async (path, body, method) => {
    if (method === 'GET') return fixture();
    if (path.endsWith('/preview')) {
      const data = body as { command: unknown; siteIds: string[] };
      return {
        batchId: `batch-${(data.command as { slug: string }).slug}`,
        command: data.command,
        impact: data.siteIds.map((siteId) => ({ siteId, name: 'Site A' })),
        warning: 'Back up first',
      };
    }
    return { success: true };
  });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function mount(
  initial = fixture(),
  attachments: SoftwareAttachment[] = [],
  initialAttachment?: string,
  siteScoped = false,
) {
  await act(async () =>
    root.render(
      createElement(SoftwareManager, {
        organizationId: 'workspace',
        initial,
        initialSite: 'site-a',
        siteScoped,
        attachments,
        initialAttachment,
      }),
    ),
  );
}
it('opens a site-scoped inventory without exposing other site selectors', async () => {
  const data = fixture();
  data.sites.push({
    ...data.sites[0]!,
    id: 'site-b',
    name: 'Other site',
    plugins: [item('other-only-plugin')],
  });
  await mount(data, [], undefined, true);
  expect(host.textContent).toContain('Current site');
  expect(host.textContent).toContain('alpha');
  expect(host.textContent).not.toContain('Other site');
  expect(host.textContent).not.toContain('other-only-plugin');
  expect(host.querySelector('.software-site input')).toBeNull();
  expect(host.querySelector('.software-site-identity')?.textContent).toContain(
    'Site A',
  );
});
function labeled<T extends HTMLElement>(name: string): T {
  const element = host.querySelector<T>(`[aria-label="${name}"]`);
  expect(element, name).not.toBeNull();
  return element!;
}
function button(text: string, within: ParentNode = host) {
  const result = [...within.querySelectorAll('button')].find(
    (element) => element.textContent?.trim() === text,
  );
  expect(result, text).toBeDefined();
  return result!;
}
async function click(element: HTMLElement) {
  await act(async () => element.click());
}
async function preview() {
  await act(async () => vi.advanceTimersByTimeAsync(400));
}
async function input(selector: string, value: string) {
  await act(async () => {
    const element = host.querySelector<HTMLInputElement>(selector)!;
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )!.set!.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
const confirms = () =>
  request.mock.calls.filter(([path]) => path.endsWith('/confirm'));

async function historySelect(index: number, value: string) {
  await act(async () => {
    const element = host.querySelectorAll<HTMLSelectElement>(
      '.operation-history-filters select',
    )[index]!;
    element.value = value;
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

it('paginates filtered history and retains locks for hidden outstanding work', async () => {
  const data = fixture();
  data.operations = Array.from({ length: 12 }, (_, index) => ({
    ...operation(
      index === 11 ? 'queued' : index < 6 ? 'cancelled' : 'succeeded',
    ),
    id: `op-${index}`,
    createdAt: `2026-10-29T00:${String(index).padStart(2, '0')}:00Z`,
  }));
  request.mockResolvedValue(data);
  await mount(data);
  const history = host.querySelector('[aria-label="Recent operations"]')!;
  expect(history.querySelectorAll('article')).toHaveLength(5);
  await click(button('Next', history));
  expect(history.textContent).toContain('6–10 of 12');
  await historySelect(0, 'cancelled');
  expect(history.textContent).toContain('1–5 of 6');
  expect(labeled<HTMLButtonElement>('activate alpha').disabled).toBe(true);
  await click(button('Next', history));
  expect(history.querySelectorAll('article')).toHaveLength(1);
  request.mockResolvedValue({
    ...data,
    operations: data.operations.filter((op) => op.status !== 'cancelled'),
  });
  await act(async () => vi.advanceTimersByTimeAsync(10_000));
  expect(history.textContent).toContain('No operations match these filters');
  expect(button('Next', history).disabled).toBe(true);
  await click(button('Clear filters', history));
  expect(history.textContent).toContain('1–5 of 6');
});

it('combines status with today, yesterday and calendar ranges', async () => {
  vi.setSystemTime(new Date('2026-10-30T12:00:00Z'));
  const data = fixture();
  data.operations = [
    { ...operation('failed'), id: 'today', createdAt: '2026-10-30T00:00:00Z' },
    {
      ...operation('failed'),
      id: 'yesterday',
      createdAt: '2026-10-29T23:59:59Z',
    },
    { ...operation('expired'), id: 'older', createdAt: '2026-10-28T23:59:59Z' },
  ];
  await mount(data);
  const history = host.querySelector('[aria-label="Recent operations"]')!;
  await historySelect(0, 'failed');
  await historySelect(1, 'today');
  expect(history.querySelectorAll('article')).toHaveLength(1);
  expect(history.querySelector('time')?.dateTime).toBe('2026-10-30T00:00:00Z');
  await historySelect(1, 'yesterday');
  expect(history.querySelector('time')?.dateTime).toBe('2026-10-29T23:59:59Z');
  await historySelect(1, 'range');
  await input('.operation-history-filters input', '2026-10-29');
  await act(async () => {
    const end = history.querySelectorAll('input')[1]!;
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )!.set!.call(end, '2026-10-30');
    end.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(history.querySelectorAll('article')).toHaveLength(2);
  await historySelect(0, 'expired');
  expect(history.textContent).toContain('No operations match these filters');
});

function operation(status: SoftwareOperation['status']): SoftwareOperation {
  return {
    id: 'op-alpha',
    batchId: 'batch-alpha',
    siteId: 'site-a',
    siteName: 'Site A',
    kind: 'plugin',
    action: 'activate',
    slug: 'alpha',
    status,
    resultCode: null,
    reason: 'Maintenance',
    createdAt: '2026-10-29T00:00:00Z',
  };
}

it.each(['queued', 'running', 'unknown'] as const)(
  'keeps site actions and bulk submission disabled while %s, including after polling',
  async (status) => {
    const data = fixture();
    data.operations = [operation(status)];
    request.mockResolvedValue(data);
    await mount(data);
    for (const name of [
      'activate alpha',
      'update alpha',
      'activate beta',
      'Add alpha to bulk operation',
    ]) {
      expect(labeled<HTMLButtonElement>(name).disabled).toBe(true);
    }
    await input('#software-slug', 'new-plugin');
    expect(button('Review installation').disabled).toBe(true);
    expect(
      host.querySelector('.software-catalog [role="status"]')?.textContent,
    ).toContain(
      status === 'unknown'
        ? 'review in WordPress'
        : status === 'running'
          ? 'Running'
          : 'Queued',
    );
    await act(async () => vi.advanceTimersByTimeAsync(20_000));
    await click(labeled('activate alpha'));
    expect(host.querySelector('dialog')).toBeNull();
    expect(confirms()).toHaveLength(0);
  },
);

it.each(['succeeded', 'failed', 'cancelled', 'expired', 'preview'] as const)(
  'releases controls after %s is read from the server',
  async (status) => {
    const data = fixture();
    data.operations = [operation('queued')];
    await mount(data);
    const next = fixture();
    next.operations = [operation(status)];
    if (status === 'succeeded') next.sites[0]!.plugins[0]!.active = true;
    request.mockResolvedValue(next);
    await act(async () => vi.advanceTimersByTimeAsync(10_000));
    expect(
      labeled<HTMLButtonElement>(
        status === 'succeeded' ? 'deactivate alpha' : 'activate alpha',
      ).disabled,
    ).toBe(false);
    expect(host.querySelector('.software-catalog [role="status"]')).toBeNull();
  },
);

it('preserves an acknowledged queued state if reloading results fails', async () => {
  await mount();
  await click(labeled('activate alpha'));
  await preview();
  const original = request.getMockImplementation()!;
  request.mockImplementation(async (path, body, method) => {
    if (path.endsWith('/confirm')) {
      request.mockRejectedValue(new Error('Reload unavailable'));
      return { success: true };
    }
    return original(path, body, method);
  });
  await click(button('Confirm and queue'));
  expect(confirms()).toHaveLength(1);
  expect(labeled<HTMLButtonElement>('activate alpha').disabled).toBe(true);
  expect(host.querySelector('.software-catalog')?.textContent).toContain(
    'Queued · awaiting Connector',
  );
  await click(labeled('activate alpha'));
  expect(host.querySelector('dialog')).toBeNull();
});

it('ignores an old polling response delivered after a queue acknowledgement', async () => {
  await mount();
  await click(labeled('activate alpha'));
  await preview();
  const original = request.getMockImplementation()!;
  let finishPoll!: (data: SoftwareDirectory) => void;
  let reads = 0;
  request.mockImplementation(async (path, body, method) => {
    if (method === 'GET') {
      if (++reads === 1)
        return new Promise<SoftwareDirectory>((resolve) => {
          finishPoll = resolve;
        });
      const data = fixture();
      if (reads > 2) data.operations = [operation('queued')];
      return data;
    }
    return original(path, body, method);
  });
  await act(async () => vi.advanceTimersByTimeAsync(10_000));
  await click(button('Confirm and queue'));
  expect(labeled<HTMLButtonElement>('activate alpha').disabled).toBe(true);
  await act(async () => finishPoll(fixture()));
  expect(labeled<HTMLButtonElement>('activate alpha').disabled).toBe(true);
  expect(host.querySelector('.software-catalog')?.textContent).toContain(
    'Queued · awaiting Connector',
  );
});

it('excludes busy sites from direct and bulk previews while allowing other sites', async () => {
  const data = fixture();
  data.operations = [operation('queued')];
  data.sites.push({ ...data.sites[0]!, id: 'site-b', name: 'Site B' });
  request.mockResolvedValue(data);
  await mount(data);
  await click(
    host.querySelectorAll<HTMLInputElement>('.software-site input')[1]!,
  );
  await click(labeled('activate alpha'));
  await preview();
  expect(request).toHaveBeenCalledWith(
    '/organizations/workspace/software/preview',
    expect.objectContaining({ siteIds: ['site-b'] }),
  );
  await click(button('Cancel', host.querySelector('dialog')!));
  await click(labeled('Add alpha to bulk operation'));
  await click(button('Review selected items'));
  await preview();
  const bodies = request.mock.calls
    .filter(([path]) => path.endsWith('/preview'))
    .map(([, body]) => body);
  expect(bodies).toHaveLength(2);
  for (const body of bodies)
    expect(body).toMatchObject({ siteIds: ['site-b'] });
});

it('direct action opens confirmation, preserves bulk selection, and cancel never queues', async () => {
  await mount();
  await click(labeled('Add beta to bulk operation'));
  await click(labeled('activate alpha'));
  expect(host.querySelector('dialog[open]')).not.toBeNull();
  expect(
    labeled<HTMLInputElement>('Select beta for bulk operation').checked,
  ).toBe(true);
  expect(
    labeled<HTMLInputElement>('Select alpha for bulk operation').checked,
  ).toBe(false);
  await preview();
  expect(request).toHaveBeenCalledWith(
    '/organizations/workspace/software/preview',
    {
      siteIds: ['site-a'],
      command: { kind: 'plugin', action: 'activate', slug: 'alpha' },
      reason: 'activate alpha from software manager',
    },
  );
  expect(confirms()).toHaveLength(0);
  await click(button('Cancel', host.querySelector('dialog')!));
  expect(host.querySelector('dialog')).toBeNull();
  expect(confirms()).toHaveLength(0);
});
it('direct confirmation queues only that component once, including rapid repeated clicks', async () => {
  await mount();
  await click(labeled('activate alpha'));
  await preview();
  const confirm = button('Confirm and queue');
  await act(async () => {
    confirm.click();
    confirm.click();
  });
  expect(confirms().map(([path]) => path)).toEqual([
    '/organizations/workspace/software/batch-alpha/confirm',
  ]);
  expect(host.textContent).toContain('Queued is not completed');
  expect(host.querySelector('dialog')).toBeNull();
});
it('checkboxes and Add to bulk only stage selection; Select visible excludes Connector', async () => {
  await mount();
  await click(labeled('Select alpha for bulk operation'));
  await click(labeled('Add beta to bulk operation'));
  expect(request).not.toHaveBeenCalled();
  expect(host.textContent).toContain('2 / 20 selected');
  expect(
    labeled<HTMLInputElement>('Select sitepulse-connector for bulk operation')
      .disabled,
  ).toBe(true);
  await click(button('Review selected items'));
  await preview();
  expect(host.querySelectorAll('dialog .software-impact > li')).toHaveLength(2);
  expect(
    request.mock.calls.filter(([path]) => path.endsWith('/preview')),
  ).toHaveLength(2);
  expect(confirms()).toHaveLength(0);
  await click(button('Cancel', host.querySelector('dialog')!));
  await click(button('Clear selection'));
  await click(labeled('Select all visible eligible components'));
  expect(host.textContent).toContain('2 / 20 selected');
  expect(
    labeled<HTMLInputElement>('Select sitepulse-connector for bulk operation')
      .checked,
  ).toBe(false);
});
it('keeps hidden search selections explicit and clears selections when switching component type', async () => {
  await mount();
  await click(labeled('Add beta to bulk operation'));
  await input('#software-search', 'alpha');
  expect(host.textContent).toContain('includes hidden search results');
  await click(button('Themes'));
  expect(host.textContent).toContain('0 / 20 selected');
  expect(host.querySelector<HTMLInputElement>('#software-search')!.value).toBe(
    '',
  );
});
it('requires replacement for theme deactivation and invalidates previews when reason changes', async () => {
  await mount();
  await click(button('Themes'));
  await click(labeled('deactivate theme-one'));
  await preview();
  expect(request).not.toHaveBeenCalled();
  expect(button('Confirm and queue').disabled).toBe(true);
  await input('#dialog-replacement', 'theme-two');
  await preview();
  expect(button('Confirm and queue').disabled).toBe(false);
  await input('#dialog-reason', 'Reviewed maintenance');
  expect(button('Confirm and queue').disabled).toBe(true);
  await preview();
  expect(request).toHaveBeenLastCalledWith(
    '/organizations/workspace/software/preview',
    {
      siteIds: ['site-a'],
      command: {
        kind: 'theme',
        action: 'deactivate',
        slug: 'theme-one',
        replacement: 'theme-two',
      },
      reason: 'Reviewed maintenance',
    },
  );
  expect(confirms()).toHaveLength(0);
});
it('does not allow execution after preview failure and can retry only the preview', async () => {
  await mount();
  request.mockRejectedValueOnce(new Error('Preview conflict'));
  await click(labeled('activate alpha'));
  await preview();
  expect(host.textContent).toContain('Preview conflict');
  expect(button('Confirm and queue').disabled).toBe(true);
  await click(button('Retry preview (does not execute)'));
  await preview();
  expect(button('Confirm and queue').disabled).toBe(false);
  expect(confirms()).toHaveLength(0);
});
it('keeps member management and protected or invalid actions disabled', async () => {
  await mount();
  expect(
    labeled<HTMLButtonElement>('uninstall sitepulse-connector').disabled,
  ).toBe(true);
  expect(labeled<HTMLButtonElement>('deactivate alpha').disabled).toBe(true);
  await act(async () => root.unmount());
  root = createRoot(host);
  await mount({ ...fixture(), canManage: false });
  expect(labeled<HTMLButtonElement>('activate alpha').disabled).toBe(true);
  expect(
    labeled<HTMLButtonElement>('Add alpha to bulk operation').disabled,
  ).toBe(true);
  expect(
    labeled<HTMLInputElement>('Select alpha for bulk operation').disabled,
  ).toBe(true);
  await click(labeled('activate alpha'));
  expect(request).not.toHaveBeenCalled();
});
it('previews a selected scanned attachment with its immutable reference and digest', async () => {
  const attachment: SoftwareAttachment = {
    id: '22222222-2222-4222-8222-222222222222',
    kind: 'plugin',
    slug: 'uploaded-plugin',
    name: 'Uploaded Plugin',
    version: '1.2.3',
    sha256: 'a'.repeat(64),
    byteSize: 2048,
    scan: {
      version: 'sitepulse-static-1',
      status: 'complete',
      scannedFiles: 2,
      findings: [],
    },
    createdAt: '2026-10-28T00:00:00Z',
  };
  await mount(fixture(), [attachment], attachment.id);
  expect(host.querySelector<HTMLSelectElement>('#software-source')!.value).toBe(
    attachment.id,
  );
  expect(host.textContent).toContain('Uploaded Uploaded Plugin v1.2.3');
  await click(button('Review installation'));
  await preview();
  expect(request).toHaveBeenCalledWith(
    '/organizations/workspace/software/preview',
    {
      siteIds: ['site-a'],
      command: {
        kind: 'plugin',
        action: 'install',
        slug: 'uploaded-plugin',
        attachmentId: attachment.id,
      },
      reason: 'install uploaded-plugin from software manager',
    },
  );
  expect(host.querySelector('dialog')?.textContent).toContain(
    `SHA-256: ${attachment.sha256}`,
  );
});
