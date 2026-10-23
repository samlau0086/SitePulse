import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cookies } from 'next/headers';
import { parseWebEnvironment } from '@sitepulse/config';
import type { Organization, Site } from '@sitepulse/api-contracts';
import { serverApi } from '../../../../lib/server-api';
import { SiteControls } from '../../../../components/sites-panel';

export default async function SitePage({
  params,
}: {
  params: Promise<{ siteId: string }>;
}) {
  const { siteId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(siteId)) notFound();
  const { user } = await serverApi<{ user: { emailVerified: boolean } }>(
    '/auth/session',
  );
  const env = parseWebEnvironment(process.env);
  const response = await fetch(
    `${env.API_INTERNAL_ORIGIN}/api/v1/sites/${siteId}`,
    { headers: { cookie: (await cookies()).toString() }, cache: 'no-store' },
  );
  if (response.status === 404 || response.status === 400) notFound();
  if (!response.ok) throw new Error('Unable to load site.');
  const { site } = (await response.json()) as { site: Site };
  const { organization } = await serverApi<{ organization: Organization }>(
    `/organizations/${site.organizationId}`,
  );
  return (
    <main>
      <Link href={`/app/organizations/${site.organizationId}`}>
        Back to workspace
      </Link>
      <section className="card">
        <h1>{site.name}</h1>
        <p>{site.canonicalUrl}</p>
        <p>
          Status: {site.status === 'degraded' ? 'Stale heartbeat' : site.status}
        </p>
        <p>
          Last heartbeat:{' '}
          {site.lastSeenAt
            ? new Date(site.lastSeenAt).toISOString()
            : 'Not received'}
        </p>
        <p>Connector version: {site.connectorVersion ?? 'Not received'}</p>
      </section>
      {organization.role !== 'member' &&
        (user.emailVerified ? (
          <SiteControls siteId={siteId} />
        ) : (
          <Link href="/verify-email">Verify email to manage this site</Link>
        ))}
    </main>
  );
}
