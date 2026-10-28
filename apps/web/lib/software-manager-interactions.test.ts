// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type {
  InstalledComponent,
  SoftwareDirectory,
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
async function mount(initial = fixture()) {
  await act(async () =>
    root.render(
      createElement(SoftwareManager, {
        organizationId: 'workspace',
        initial,
        initialSite: 'site-a',
      }),
    ),
  );
}
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
