// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { SiteSecurityReport } from '@sitepulse/api-contracts';
import { SecurityPanel } from '../components/security-panel';

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

it('filters environment and advisory findings from severity tiles and clears the filter', async () => {
  const security: SiteSecurityReport = {
    status: 'current',
    checkedAt: null,
    nextCheckAt: null,
    coverage: {
      inventory: 'complete',
      localFiles: 'partial',
      publicVulnerabilities: 'complete',
    },
    environmentRisks: [
      { code: 'high-risk', severity: 'high', message: 'High environment risk' },
      {
        code: 'medium-risk',
        severity: 'medium',
        message: 'Medium environment risk',
      },
    ],
    localFindings: [{ rule: 'php_in_uploads', path: 'uploads/review.php' }],
    vulnerabilities: [
      {
        componentType: 'php',
        component: 'php',
        installedVersion: '8.4.13',
        id: 'critical-advisory',
        title: 'Critical advisory',
        severity: 'critical',
        fixedVersion: '8.4.21',
        sourceUrl: null,
        supplyChain: false,
      },
      {
        componentType: 'wordpress',
        component: 'wordpress',
        installedVersion: '6.8',
        id: 'high-advisory',
        title: 'High advisory',
        severity: 'high',
        fixedVersion: '6.8.1',
        sourceUrl: null,
        supplyChain: false,
      },
    ],
    errorCode: null,
  };
  await act(async () => {
    root.render(
      createElement(SecurityPanel, {
        security,
        inventory: null,
        softwareHref: '/app/software',
        canManage: false,
      }),
    );
  });

  const critical = host.querySelector<HTMLButtonElement>(
    'button[aria-label^="Filter by Critical"]',
  );
  expect(critical).not.toBeNull();
  await act(async () => critical!.click());
  expect(critical!.getAttribute('aria-pressed')).toBe('true');
  expect(host.textContent).toContain('Critical advisory');
  expect(host.textContent).not.toContain('High advisory');
  expect(host.textContent).not.toContain('High environment risk');
  expect(host.textContent).toContain('uploads/review.php');
  expect(host.textContent).toContain('No Critical environment risks');

  const clear = Array.from(host.querySelectorAll('button')).find(
    (button) => button.textContent === 'Clear filter',
  );
  await act(async () => clear!.click());
  expect(host.textContent).toContain('High advisory');
  expect(host.textContent).toContain('High environment risk');
});
