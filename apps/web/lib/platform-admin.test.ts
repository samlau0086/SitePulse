import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';
import { AppNavigation } from '../components/app-navigation';
import { PlatformAdmin } from '../components/platform-admin';
import PlatformAdminPage from '../app/app/admin/page';

const { session, serverApi } = vi.hoisted(() => ({
  session: vi.fn(),
  serverApi: vi.fn(),
}));
vi.mock('next/link', () => ({ default: 'a' }));
vi.mock('next/navigation', () => ({
  usePathname: () => '/app/admin',
  useRouter: () => ({ refresh: vi.fn() }),
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
}));
vi.mock('./workspace', () => ({ workspaceSession: session }));
vi.mock('./server-api', () => ({ serverApi }));
beforeEach(() => {
  vi.clearAllMocks();
});
it('shows the direct platform destination only to platform administrators', () => {
  expect(renderToStaticMarkup(createElement(AppNavigation))).not.toContain(
    '/app/admin',
  );
  expect(
    renderToStaticMarkup(
      createElement(AppNavigation, { isPlatformAdmin: true }),
    ),
  ).toContain('href="/app/admin" aria-current="page"');
});
it('guards server rendering before accessing the platform directory', async () => {
  session.mockResolvedValue({ user: { isPlatformAdmin: false } });
  await expect(PlatformAdminPage()).rejects.toThrow('NOT_FOUND');
  expect(serverApi).not.toHaveBeenCalled();
  session.mockResolvedValue({ user: { isPlatformAdmin: true } });
  serverApi.mockImplementation(async (path: string) =>
    path === '/admin/branding'
      ? { brand: { name: 'SitePulse', logoUrl: null } }
      : { workspaces: [], hasMore: false },
  );
  const html = renderToStaticMarkup(await PlatformAdminPage());
  expect(html).toContain('Platform administration');
  expect(html).toContain('Platform email branding');
  expect(serverApi).toHaveBeenCalledWith('/admin/workspaces');
  expect(serverApi).toHaveBeenCalledWith('/admin/branding');
});
it('renders searchable usage and empty states without an unpreviewed save button', () => {
  const empty = renderToStaticMarkup(
    createElement(PlatformAdmin, {
      initial: { workspaces: [], hasMore: false },
    }),
  );
  expect(empty).toContain('No matching workspaces.');
  const html = renderToStaticMarkup(
    createElement(PlatformAdmin, {
      initial: {
        hasMore: false,
        workspaces: [
          {
            id: 'workspace',
            name: '<Workspace>',
            slug: 'workspace',
            usage: {
              planCode: 'free',
              siteLimit: 2,
              siteLimitOverride: null,
              sitesUsed: 3,
              sitesRemaining: 0,
              canAddSite: false,
              overLimit: true,
            },
          },
        ],
      },
    }),
  );
  expect(html).toContain('Name, slug or workspace ID');
  expect(html).toContain('Free · 3 / 2 sites');
  expect(html).toContain('Over site limit.');
  expect(html).toContain('&lt;Workspace&gt;');
  expect(html).not.toContain('Confirm and save');
});
