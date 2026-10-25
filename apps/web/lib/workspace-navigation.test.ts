import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';
import type { Incident, Organization, Site } from '@sitepulse/api-contracts';
import { AppNavigation, PublicHeader } from '../components/app-navigation';
import {
  filterSites,
  SiteDirectory,
  IncidentDirectory,
} from '../components/workspace-directory';
import NewSitePage from '../app/app/sites/new/page';
import { workspaceData } from './workspace';

const { pathname, api, session, organizations, usage } = vi.hoisted(() => ({
  pathname: vi.fn(),
  api: vi.fn(),
  session: vi.fn(),
  organizations: vi.fn(),
  usage: vi.fn(),
}));
vi.mock('next/link', () => ({ default: 'a' }));
vi.mock('next/navigation', () => ({
  usePathname: pathname,
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));
vi.mock('./server-api', () => ({ serverApi: api }));
vi.mock('../components/incident-action', () => ({
  IncidentAction: () => createElement('button', null, 'Acknowledge'),
}));
vi.mock('./workspace', async (original) => ({
  ...(await original<typeof import('./workspace')>()),
  workspaceSession: session,
  workspaceOrganizations: organizations,
  workspaceUsage: usage,
}));

const org: Organization = {
  id: 'workspace-a',
  name: 'Alpha team',
  slug: 'alpha',
  role: 'owner',
};
const site: Site = {
  id: 'site-a',
  organizationId: org.id,
  name: 'Alpha site',
  hostname: 'alpha.example.com',
  canonicalUrl: 'https://alpha.example.com',
  status: 'degraded',
  lastSeenAt: null,
  connectorVersion: null,
};
const incident: Incident = {
  id: 'incident-a',
  siteId: site.id,
  monitorType: 'uptime',
  status: 'open',
  severity: 'critical',
  startedAt: '2026-10-24T00:00:00.000Z',
  resolvedAt: null,
  resolutionReason: null,
};
const render = (component: React.ReactNode) => renderToStaticMarkup(component);
beforeEach(() => {
  vi.clearAllMocks();
  pathname.mockReturnValue('/app/sites/site-a');
  usage.mockResolvedValue({
    usage: {
      planCode: 'free',
      siteLimit: 2,
      siteLimitOverride: null,
      sitesUsed: 0,
      sitesRemaining: 2,
      canAddSite: true,
      overLimit: false,
    },
  });
});

it('keeps all main destinations one click away and marks nested site pages active', () => {
  const html = render(createElement(AppNavigation));
  for (const path of [
    '/app',
    '/app/sites',
    '/app/incidents',
    '/app/organizations',
  ])
    expect(html).toContain(`href="${path}"`);
  expect(html).toMatch(/href="\/app\/sites" aria-current="page"/);
  expect(html.match(/aria-current="page"/g)).toHaveLength(1);
  expect(render(createElement(PublicHeader))).toBe('');
  pathname.mockReturnValue('/login');
  expect(render(createElement(PublicHeader))).toContain('Main navigation');
});
it('filters sites by case-insensitive name or host and workspace together', () => {
  const other = {
    ...site,
    id: 'site-b',
    name: 'Beta',
    hostname: 'beta.example.com',
    organizationId: 'workspace-b',
  };
  expect(filterSites([site, other], ' ALPHA ', '')).toEqual([site]);
  expect(filterSites([site, other], 'EXAMPLE.COM', 'workspace-b')).toEqual([
    other,
  ]);
  expect(filterSites([site, other], 'alpha', 'workspace-b')).toEqual([]);
});
it('provides direct site section links and distinguishes connector status from HTTP health', () => {
  const html = render(
    createElement(SiteDirectory, {
      sites: [site],
      organizations: [org],
      incidents: [incident],
    }),
  );
  for (const view of ['monitoring', 'inventory', 'connection'])
    expect(html).toContain(`/app/sites/site-a?view=${view}`);
  expect(html).toContain('Stale heartbeat');
  expect(html).toContain('not HTTP availability');
  expect(html).toContain('Alpha team');
});
it('offers useful empty-state routes instead of an empty list', () => {
  const html = render(
    createElement(SiteDirectory, {
      sites: [],
      organizations: [],
      incidents: [],
    }),
  );
  expect(html).toContain('href="/app/sites/new"');
  expect(html).toContain('Add your first site');
});
it.each([
  ['owner', true, 'open', true],
  ['admin', true, 'open', true],
  ['member', true, 'open', false],
  ['owner', false, 'open', false],
  ['owner', true, 'resolved', false],
] as const)(
  'limits incident acknowledgement for %s, verified=%s, status=%s',
  (role, verified, status, visible) => {
    const html = render(
      createElement(IncidentDirectory, {
        sites: [site],
        organizations: [{ ...org, role }],
        incidents: [{ ...incident, status }],
        canManage: verified,
      }),
    );
    expect(html.includes('>Acknowledge</button>')).toBe(visible);
  },
);
it('requires verification before rendering the site creation form', async () => {
  organizations.mockResolvedValue({ organizations: [org] });
  session.mockResolvedValue({ user: { emailVerified: false } });
  const html = render(await NewSitePage());
  expect(html).toContain('href="/verify-email"');
  expect(html).not.toContain('<form');
  expect(usage).not.toHaveBeenCalled();
});
it('offers only owner/admin workspaces for site creation', async () => {
  organizations.mockResolvedValue({
    organizations: [
      org,
      { ...org, id: 'member-org', name: 'Member workspace', role: 'member' },
    ],
  });
  session.mockResolvedValue({ user: { emailVerified: true } });
  const html = render(await NewSitePage());
  expect(html).toContain('Alpha team');
  expect(html).not.toContain('Member workspace');
  expect(usage).toHaveBeenCalledExactlyOnceWith(org.id);
  expect(html).toContain('0 / 2 sites');
});
it('shows capacity and disables creation when the selected workspace is full', async () => {
  organizations.mockResolvedValue({ organizations: [org] });
  session.mockResolvedValue({ user: { emailVerified: true } });
  usage.mockResolvedValue({
    usage: {
      planCode: 'free',
      siteLimit: 2,
      siteLimitOverride: null,
      sitesUsed: 3,
      sitesRemaining: 0,
      canAddSite: false,
      overLimit: true,
    },
  });
  const html = render(await NewSitePage());
  expect(html).toContain('3 / 2 sites');
  expect(html).toContain('Over site limit.');
  expect(html).toContain('Existing sites continue monitoring.');
  expect(html).toMatch(/<button disabled="">Add and connect site/);
});
it('loads aggregate data only through membership-scoped organization endpoints', async () => {
  api.mockImplementation(async (path: string) => {
    if (path === '/organizations') return { organizations: [org] };
    if (path === `/organizations/${org.id}/sites`) return { sites: [site] };
    if (path === `/organizations/${org.id}/incidents`)
      return { incidents: [incident] };
    throw new Error('Unexpected endpoint');
  });
  expect(await workspaceData()).toEqual({
    organizations: [org],
    sites: [site],
    incidents: [incident],
  });
  expect(api).toHaveBeenCalledTimes(3);
});
