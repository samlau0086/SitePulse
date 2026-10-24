import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cookies } from 'next/headers';
import { parseWebEnvironment } from '@sitepulse/config';
import { serverApi } from '../../../../lib/server-api';
import type { Incident, Organization, Site } from '@sitepulse/api-contracts';
import {
  SiteDirectory,
  IncidentDirectory,
} from '../../../../components/workspace-directory';

export default async function OrganizationPage({
  params,
}: {
  params: Promise<{ organizationId: string }>;
}) {
  const { organizationId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(organizationId)) notFound();
  // Authentication is server-side; the API separately enforces membership.
  const { user } = await serverApi<{ user: { emailVerified: boolean } }>(
    '/auth/session',
  );
  const env = parseWebEnvironment(process.env);
  const response = await fetch(
    `${env.API_INTERNAL_ORIGIN}/api/v1/organizations/${organizationId}`,
    { headers: { cookie: (await cookies()).toString() }, cache: 'no-store' },
  );
  if (response.status === 404 || response.status === 400) notFound();
  if (!response.ok) throw new Error('Unable to load this organization.');
  const { organization } = (await response.json()) as {
    organization: Organization;
  };
  const { sites } = await serverApi<{ sites: Site[] }>(
    `/organizations/${organizationId}/sites`,
  );
  const { incidents } = await serverApi<{ incidents: Incident[] }>(
    `/organizations/${organizationId}/incidents`,
  );
  return (
    <main>
      <div className="page-heading">
        <div>
          <p className="eyebrow">WORKSPACE</p>
          <h1>{organization.name}</h1>
          <p className="muted">
            {organization.slug} · Your role: {organization.role}
          </p>
          {!user.emailVerified && (
            <Link href="/verify-email">Verify your email to manage sites</Link>
          )}
        </div>
        <Link className="button secondary" href="/app/organizations">
          All workspaces
        </Link>
      </div>
      <div className="section-heading">
        <h2>Workspace sites</h2>
        {organization.role !== 'member' && user.emailVerified && (
          <Link href="/app/sites/new">+ Add site</Link>
        )}
      </div>
      <SiteDirectory
        organizations={[organization]}
        sites={sites}
        incidents={incidents}
      />
      <div className="section-heading">
        <h2>Recent incidents</h2>
      </div>
      <IncidentDirectory
        sites={sites}
        organizations={[organization]}
        incidents={incidents}
        canManage={organization.role !== 'member' && user.emailVerified}
      />
    </main>
  );
}
