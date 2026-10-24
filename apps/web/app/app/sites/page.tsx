import Link from 'next/link';
import { workspaceData } from '../../../lib/workspace';
import { SiteDirectory } from '../../../components/workspace-directory';
export default async function SitesPage() {
  const data = await workspaceData();
  return (
    <main>
      <div className="page-heading">
        <div>
          <p className="eyebrow">SITE DIRECTORY</p>
          <h1>All sites</h1>
          <p className="muted">
            Go straight to monitoring, inventory or connection settings.
          </p>
        </div>
        <Link className="button" href="/app/sites/new">
          + Add site
        </Link>
      </div>
      <SiteDirectory {...data} />
    </main>
  );
}
