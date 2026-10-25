import Link from 'next/link';
import { workspaceOrganizations, workspaceUsage } from '../../../lib/workspace';
import { PlanUsage } from '../../../components/plan-usage';
import { CreateOrganizationForm } from '../../../components/workspace-actions';
export default async function OrganizationsPage() {
  const { organizations } = await workspaceOrganizations();
  return (
    <main>
      <div className="page-heading">
        <div>
          <p className="eyebrow">ORGANIZATION MANAGEMENT</p>
          <h1>Workspaces</h1>
          <p className="muted">
            Manage the organizations your sites belong to.
          </p>
        </div>
      </div>
      <div className="workspace-grid">
        {organizations.map(async (organization) => (
          <Link
            className="workspace-card"
            key={organization.id}
            href={`/app/organizations/${organization.id}`}
          >
            <span className="avatar">{organization.name.slice(0, 1)}</span>
            <h2>{organization.name}</h2>
            <span className="muted">
              {organization.slug} · {organization.role}
            </span>
            <PlanUsage usage={(await workspaceUsage(organization.id)).usage} />
            <p>Open workspace →</p>
          </Link>
        ))}
      </div>
      {!organizations.length && (
        <div className="empty-state">
          <h2>Create your first workspace</h2>
          <p>Group your sites in a workspace to get started.</p>
        </div>
      )}
      <CreateOrganizationForm />
    </main>
  );
}
