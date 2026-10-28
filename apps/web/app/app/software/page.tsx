import Link from 'next/link';
import type {
  SoftwareDirectory,
  AttachmentDirectory,
} from '@sitepulse/api-contracts';
import { workspaceOrganizations } from '../../../lib/workspace';
import { serverApi } from '../../../lib/server-api';
import { SoftwareManager } from '../../../components/software-manager';

export default async function SoftwarePage({
  searchParams,
}: {
  searchParams: Promise<{
    workspace?: string;
    site?: string;
    attachment?: string;
  }>;
}) {
  const { organizations } = await workspaceOrganizations();
  const query = await searchParams;
  const selected =
    organizations.find((org) => org.id === query.workspace) ?? organizations[0];
  const initial = selected
    ? await serverApi<SoftwareDirectory>(
        `/organizations/${selected.id}/software`,
      )
    : null;
  const library = selected
    ? await serverApi<AttachmentDirectory>(
        `/organizations/${selected.id}/attachments`,
      )
    : null;
  return (
    <main>
      <div className="page-heading">
        <div>
          <p className="eyebrow">WORDPRESS MANAGEMENT</p>
          <h1>Plugins & themes</h1>
          <p className="muted">
            Manage software across your sites, with a preview and individual
            results.
          </p>
        </div>
      </div>
      {selected && initial ? (
        <>
          <form className="directory-toolbar" action="/app/software">
            <label htmlFor="software-workspace">Workspace</label>
            <select
              name="workspace"
              id="software-workspace"
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
          <SoftwareManager
            key={selected.id}
            organizationId={selected.id}
            initial={initial}
            initialSite={query.site}
            attachments={library?.attachments ?? []}
            initialAttachment={query.attachment}
          />
        </>
      ) : (
        <p>
          <Link href="/app/organizations">Create a workspace</Link> to manage
          WordPress software.
        </p>
      )}
    </main>
  );
}
