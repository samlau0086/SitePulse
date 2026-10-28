import { notFound } from 'next/navigation';
import type {
  AdminWorkspace,
  EmailBrandSettings,
} from '@sitepulse/api-contracts';
import { EmailBrandingForm } from '../../../components/email-branding';
import { workspaceSession } from '../../../lib/workspace';
import { serverApi } from '../../../lib/server-api';
import { PlatformAdmin } from '../../../components/platform-admin';

export default async function PlatformAdminPage() {
  const { user } = await workspaceSession();
  if (!user.isPlatformAdmin) notFound();
  const branding = await serverApi<{ brand: EmailBrandSettings }>(
    '/admin/branding',
  );
  const initial = await serverApi<{
    workspaces: AdminWorkspace[];
    hasMore: boolean;
  }>('/admin/workspaces');
  return (
    <main>
      <div className="page-heading">
        <div>
          <p className="eyebrow">PLATFORM ADMINISTRATION</p>
          <h1>Platform administration</h1>
          <p className="muted">
            Search workspaces, review usage and adjust site allowances.
          </p>
        </div>
      </div>
      <PlatformAdmin initial={initial} />
      <EmailBrandingForm initial={branding.brand} admin />
    </main>
  );
}
