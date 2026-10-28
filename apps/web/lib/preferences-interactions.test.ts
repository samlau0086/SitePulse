// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { UserPreferencesForm } from '../components/user-preferences';

const { api, refresh } = vi.hoisted(() => ({ api: vi.fn(), refresh: vi.fn() }));
vi.mock('./api', () => ({ api }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

it('saves only on explicit submit, disables pending changes and reports errors without refreshing', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        createElement(UserPreferencesForm, {
          timeZone: 'UTC',
          availableTimeZones: ['Asia/Shanghai', 'America/New_York'],
        }),
      ),
    );
    const select = host.querySelector('select')!;
    expect(select.value).toBe('UTC');
    await act(async () => {
      select.value = 'Asia/Shanghai';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(api).not.toHaveBeenCalled();
    let finish!: () => void;
    api.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const form = host.querySelector('form')!;
    await act(async () =>
      form.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true }),
      ),
    );
    expect(api).toHaveBeenCalledWith(
      '/users/me/preferences',
      { timeZone: 'Asia/Shanghai' },
      'PATCH',
    );
    expect(host.querySelector('fieldset')!.disabled).toBe(true);
    expect(refresh).not.toHaveBeenCalled();
    await act(async () => finish());
    expect(host.querySelector('fieldset')!.disabled).toBe(false);
    expect(host.querySelector('[role="status"]')!.textContent).toContain(
      'Asia/Shanghai',
    );
    expect(refresh).toHaveBeenCalledTimes(1);
    api.mockRejectedValueOnce(new Error('Save failed'));
    await act(async () =>
      form.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true }),
      ),
    );
    expect(host.querySelector('[role="alert"]')!.textContent).toBe(
      'Save failed',
    );
    expect(host.querySelector('[role="status"]')).toBeNull();
    expect(refresh).toHaveBeenCalledTimes(1);
    const browserButton = host.querySelector('button[type="button"]')!;
    await act(async () => (browserButton as HTMLButtonElement).click());
    expect(select.value).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
    expect(api).toHaveBeenCalledTimes(2);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  }
});
