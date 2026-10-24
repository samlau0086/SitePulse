'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';

export const navigation = [
  { href: '/app', label: 'Overview', icon: '[=]' },
  { href: '/app/sites', label: 'Sites', icon: '[+]' },
  { href: '/app/incidents', label: 'Incidents', icon: '[!]' },
  { href: '/app/organizations', label: 'Workspaces', icon: '[#]' },
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
export function AppNavigation() {
  const pathname = usePathname();
  return (
    <nav className="app-navigation" aria-label="Workspace navigation">
      {navigation.map(({ href, label, icon }) => {
        const active =
          href === '/app' ? pathname === href : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? 'page' : undefined}
          >
            <span aria-hidden="true">{icon}</span>
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
      Refresh data
    </button>
  );
}
