import Link from 'next/link';
import { Icon, type IconName } from './icon';

export function SiteTabs({
  siteId,
  organizationId,
  view,
}: {
  siteId: string;
  organizationId: string;
  view: string;
}) {
  const tabs: Array<{ id: string; label: string; icon: IconName }> = [
    { id: 'monitoring', label: 'Monitoring', icon: 'pulse' },
    { id: 'software', label: 'Plugins & themes', icon: 'connection' },
    { id: 'security', label: 'Security', icon: 'shield' },
    { id: 'inventory', label: 'Inventory', icon: 'inventory' },
    { id: 'connection', label: 'Connection', icon: 'globe' },
  ];
  return (
    <nav className="site-tabs" aria-label="Site sections">
      {tabs.map((tab) => (
        <Link
          key={tab.id}
          href={
            tab.id === 'software'
              ? `/app/software?workspace=${organizationId}&site=${siteId}`
              : `/app/sites/${siteId}?view=${tab.id}`
          }
          aria-current={view === tab.id ? 'page' : undefined}
        >
          <Icon name={tab.icon} />
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
