import Link from 'next/link';
import { AppNavigation, RefreshButton } from '../../components/app-navigation';
import { LogoutButton } from '../../components/workspace-actions';
import { workspaceSession } from '../../lib/workspace';

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user } = await workspaceSession();
  return (
    <div className="app-shell">
      <a className="skip-link" href="#workspace-content">
        Skip to content
      </a>
      <aside className="app-sidebar">
        <Link className="brand" href="/app">
          <span className="brand-mark" aria-hidden="true">
            [s/p]
          </span>
          SitePulse
        </Link>
        <p className="eyebrow sidebar-caption">OPERATIONS WORKSPACE</p>
        <AppNavigation isPlatformAdmin={user.isPlatformAdmin} />
        <div className="sidebar-account">
          <span className="avatar" aria-hidden="true">
            {user.name.slice(0, 1).toUpperCase()}
          </span>
          <strong>{user.name}</strong>
          <span className="muted account-email">{user.email}</span>
          <LogoutButton />
        </div>
      </aside>
      <div className="app-body">
        <header className="app-topbar">
          <span className="muted">Website operations, in one place</span>
          <RefreshButton />
        </header>
        {!user.emailVerified && (
          <div className="verification-banner">
            Verify your email to add and manage sites.{' '}
            <Link href="/verify-email">Verify email →</Link>
          </div>
        )}
        <div id="workspace-content" tabIndex={-1}>
          {children}
        </div>
      </div>
    </div>
  );
}
