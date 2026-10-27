import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import type { Site } from '@sitepulse/api-contracts';
import { ConnectionSummary } from '../components/connection-summary';
vi.mock('next/link', () => ({ default: 'a' }));

function site(status: Site['status'], index: number): Site {
  return {
    id: `site-${index}`,
    organizationId: 'org',
    name: `Site ${index}`,
    hostname: 'example.com',
    canonicalUrl: 'https://example.com',
    status,
    lastSeenAt: null,
    connectorVersion: null,
  };
}
it('represents all connector states and points attention at the relevant destinations', () => {
  const sites = (
    ['active', 'active', 'degraded', 'pending', 'disconnected'] as const
  ).map(site);
  const html = renderToStaticMarkup(
    createElement(ConnectionSummary, { sites, unresolved: 3 }),
  );
  expect(html).toContain('stroke-dasharray="40 60"');
  expect(html.match(/stroke-dasharray="20 80"/g)).toHaveLength(3);
  expect(html).toContain('Awaiting pairing');
  expect(html).toContain('Disconnected');
  expect(html).toContain('1 connector needs');
  expect(html).toContain('2 sites need');
  expect(html).toContain('3 unresolved in recent history');
  expect(html).toContain('href="/app/sites"');
  expect(html).toContain('href="/app/incidents"');
  expect(html).toContain('separate from HTTP availability');
});
it('handles no sites without invalid chart values or invented health', () => {
  const html = renderToStaticMarkup(
    createElement(ConnectionSummary, { sites: [], unresolved: 0 }),
  );
  expect(html).not.toMatch(/NaN|Infinity/);
  expect(html).toContain('Start with your first website');
  expect(html).toContain('href="/app/sites/new"');
  expect(html).not.toContain('100%');
});
