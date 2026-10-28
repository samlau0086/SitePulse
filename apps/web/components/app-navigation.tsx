'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Icon, type IconName } from './icon';

export const navigation = [
  { href: '/app', label: 'Overview', icon: 'overview' },
  { href: '/app/sites', label: 'Sites', icon: 'globe' },
  { href: '/app/software', label: 'Plugins & themes', icon: 'connection' },
  { href: '/app/attachments', label: 'Attachments', icon: 'overview' },
  { href: '/app/incidents', label: 'Incidents', icon: 'alert' },
  { href: '/app/notifications', label: 'Notifications', icon: 'mail' },
  { href: '/app/organizations', label: 'Workspaces', icon: 'workspace' },
];
export function PublicHeader() {
  const pathname = usePathname();
  if (pathname === '/app' || pathname.startsWith('/app/')) return null;
  return (
    <nav className="public-header" aria-label="Main navigation">
      <Link className="brand" href="/">
        <span className="brand-mark" aria-hidden="true">
          [s/p]
        </span>
        SitePulse
      </Link>
      <Link href="/app">Workspace</Link>
    </nav>
  );
}
export function AppNavigation({
  isPlatformAdmin = false,
}: {
  isPlatformAdmin?: boolean;
}) {
  const pathname = usePathname();
  return (
    <nav className="app-navigation" aria-label="Workspace navigation">
      {[
        ...navigation,
        ...(isPlatformAdmin
          ? [{ href: '/app/admin', label: 'Platform admin', icon: 'shield' }]
          : []),
      ].map(({ href, label, icon }) => {
        const active =
          href === '/app' ? pathname === href : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? 'page' : undefined}
          >
            <Icon name={icon as IconName} />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
export function RefreshButton() {
  const router = useRouter();
  return (
    <button className="secondary" onClick={() => router.refresh()}>
      <Icon name="refresh" />
      Refresh data
    </button>
  );
}
