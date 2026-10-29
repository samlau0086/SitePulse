import Link from 'next/link';
import type {
  AttachmentDirectory,
  DriveConnection,
} from '@sitepulse/api-contracts';
import { workspaceOrganizations } from '../../../lib/workspace';
import { serverApi } from '../../../lib/server-api';
import { AttachmentManager } from '../../../components/attachment-manager';

export default async function AttachmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ workspace?: string; drive?: string }>;
}) {
  const { organizations } = await workspaceOrganizations();
  const query = await searchParams;
  const drive = await serverApi<DriveConnection>('/me/google-drive');
  const selected =
    organizations.find((org) => org.id === query.workspace) ?? organizations[0];
  const initial = selected
    ? await serverApi<AttachmentDirectory>(
        `/organizations/${selected.id}/attachments`,
      )
    : null;
  return (
    <main>
      <div className="page-heading">
        <div>
          <p className="eyebrow">WORKSPACE LIBRARY</p>
          <h1>Attachments</h1>
          <p className="muted">
            Upload, inspect and reuse WordPress plugin and theme packages.
          </p>
        </div>
      </div>
      {selected && initial ? (
        <>
          <form className="directory-toolbar" action="/app/attachments">
            <label htmlFor="attachment-workspace">Workspace</label>
            <select
              name="workspace"
              id="attachment-workspace"
              defaultValue={selected.id}
            >
              {organizations.map((org) => (
                <option key={org.id} value={org.id}>
                  {org.name}
                </option>
              ))}
            </select>
            <button className="secondary">Open workspace</button>
          </form>
          <AttachmentManager
            key={selected.id}
            organizationId={selected.id}
            initial={initial}
            initialDrive={drive}
            driveResult={query.drive}
          />
        </>
      ) : (
        <p>
          <Link href="/app/organizations">Create a workspace</Link> to upload
          packages.
        </p>
      )}
    </main>
  );
}
