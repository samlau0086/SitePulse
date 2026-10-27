import { notFound } from 'next/navigation';
import type { AdminWorkspace } from '@sitepulse/api-contracts';
import { workspaceSession } from '../../../lib/workspace';
import { serverApi } from '../../../lib/server-api';
import { PlatformAdmin } from '../../../components/platform-admin';

export default async function PlatformAdminPage() {
  const { user } = await workspaceSession();
  if (!user.isPlatformAdmin) notFound();
  const initial = await serverApi<{
    workspaces: AdminWorkspace[];
    hasMore: boolean;
  }>('/admin/workspaces');
  return (
    <main>
      <div className="page-heading">
        <div>
          <p className="eyebrow">PLATFORM ADMINISTRATION</p>
          <h1>Workspace entitlements</h1>
          <p className="muted">
            Search workspaces, review usage and adjust site allowances.
          </p>
        </div>
      </div>
      <PlatformAdmin initial={initial} />
    </main>
  );
}
