import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import type { SoftwareDirectory } from '@sitepulse/api-contracts';
import { SoftwareManager } from '../components/software-manager';

function render(
  status: SoftwareDirectory['sites'][number]['inventorySync']['status'],
  canManage = true,
) {
  const initial: SoftwareDirectory = {
    canManage,
    operations: [],
    sites: [
      {
        id: 'site-fixture',
        name: 'Test site',
        canonicalUrl: 'https://site.example.test',
        enabled: true,
        polledAt: '2026-10-28T00:00:00Z',
        inventoryAt: status === 'not_received' ? null : '2026-10-27T00:00:00Z',
        canSync: true,
        plugins: [],
        themes: [],
        inventorySync: {
          status,
          requestedAt: null,
          attemptedAt: null,
          error: status === 'failed' ? 'collection' : null,
        },
      },
    ],
  };
  return renderToStaticMarkup(
    createElement(SoftwareManager, {
      organizationId: 'workspace-fixture',
      initial,
      initialSite: 'site-fixture',
    }),
  );
}

it('separates never received inventory from healthy management and explicit read-only sync', () => {
  const html = render('not_received');
  expect(html).toContain('Management ready');
  expect(html).toContain('Not yet synced');
  expect(html).toContain('Reload results');
  expect(html).toContain('Sync inventory for Test site');
  expect(html).toContain('Some selected sites have not sent inventory yet');
  for (const label of html.matchAll(/<label\b[^>]*>([\s\S]*?)<\/label>/g)) {
    expect(label[1]).not.toContain('<button');
  }
});
it('shows failures without losing last success or implying the site is offline', () => {
  const html = render('failed');
  expect(html).toContain('Inventory sync failed');
  expect(html).toContain('WordPress could not collect inventory');
  expect(html).toContain('Last successful inventory is retained');
  expect(html).toContain('Last inventory received');
  expect(html).toContain('Management ready');
});
it('disables duplicate and read-only sync actions and explains timeout', () => {
  expect(render('pending')).toMatch(
    /disabled="" aria-label="Sync inventory for Test site"/,
  );
  expect(render('succeeded', false)).toMatch(
    /disabled="" aria-label="Sync inventory for Test site"/,
  );
  expect(render('pending')).toContain('Sync queued');
  expect(render('timed_out')).toContain('Sync timed out');
});
