import Link from 'next/link';
import {
  workspaceOrganizations,
  workspaceSession,
  workspaceUsage,
} from '../../../../lib/workspace';
import { AddSiteForm } from '../../../../components/workspace-directory';
export default async function NewSitePage() {
  const [{ organizations }, { user }] = await Promise.all([
    workspaceOrganizations(),
    workspaceSession(),
  ]);
  const manageable = organizations.filter(
    (organization) => organization.role !== 'member',
  );
  const usageEntries = await Promise.all(
    (user.emailVerified ? manageable : []).map(
      async (organization) =>
        [
          organization.id,
          (await workspaceUsage(organization.id)).usage,
        ] as const,
    ),
  );
  return (
    <main>
      <div className="page-heading">
        <div>
          <p className="eyebrow">CONNECT YOUR WEBSITE</p>
          <h1>Add a site</h1>
          <p className="muted">
            Choose a workspace and enter your public WordPress URL.
          </p>
        </div>
      </div>
      {!user.emailVerified ? (
        <p className="card">
          <Link href="/verify-email">Verify your email to add a site →</Link>
        </p>
      ) : manageable.length ? (
        <AddSiteForm
          organizations={manageable}
          usages={Object.fromEntries(usageEntries)}
        />
      ) : (
        <div className="empty-state">
          <h2>A workspace is required</h2>
          <p>You need an owner or admin role to add sites.</p>
          <Link className="button" href="/app/organizations">
            Manage workspaces
          </Link>
        </div>
      )}
    </main>
  );
}
