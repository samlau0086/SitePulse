import { workspaceData, workspaceSession } from '../../../lib/workspace';
import { IncidentDirectory } from '../../../components/workspace-directory';
export default async function IncidentsPage() {
  const [data, { user }] = await Promise.all([
    workspaceData(),
    workspaceSession(),
  ]);
  return (
    <main>
      <div className="page-heading">
        <div>
          <p className="eyebrow">MONITORING ACTIVITY</p>
          <h1>Incidents</h1>
          <p className="muted">
            Review and acknowledge incidents across your workspaces.
          </p>
        </div>
      </div>
      <p className="data-note">
        Latest 100 incidents per workspace. Acknowledging an incident does not
        mark it recovered.
      </p>
      <IncidentDirectory {...data} canManage={user.emailVerified} />
    </main>
  );
}
