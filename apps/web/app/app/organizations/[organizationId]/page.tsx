import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cookies } from 'next/headers';
import { parseWebEnvironment } from '@sitepulse/config';
import { serverApi } from '../../../../lib/server-api';
import type { Organization, Site } from '@sitepulse/api-contracts';
import { SitesPanel } from '../../../../components/sites-panel';

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
  return (
    <main>
      <Link href="/app">All organizations</Link>
      <section className="card">
        <h1>{organization.name}</h1>
        <p>Workspace: {organization.slug}</p>
        <p>Your role: {organization.role}</p>
        {!user.emailVerified && (
          <Link href="/verify-email">Verify your email to manage sites</Link>
        )}
      </section>
      <SitesPanel
        organizationId={organizationId}
        sites={sites}
        canManage={organization.role !== 'member' && user.emailVerified}
      />
    </main>
  );
}
