import Link from 'next/link';
import { workspaceOrganizations } from '../../../lib/workspace';
import { serverApi } from '../../../lib/server-api';
import type { NotificationConfiguration } from '@sitepulse/api-contracts';
import { NotificationSettings } from '../../../components/notification-settings';

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ workspace?: string }>;
}) {
  const { organizations } = await workspaceOrganizations();
  const { workspace } = await searchParams;
  // Only select from the authenticated membership list, never from an unchecked query ID.
  const selected =
    organizations.find((row) => row.id === workspace) ?? organizations[0];
  const initial = selected
    ? await serverApi<NotificationConfiguration>(
        `/organizations/${selected.id}/notification-endpoints`,
      )
    : null;
  return (
    <main>
      <div className="page-heading">
        <div>
          <p className="eyebrow">WORKSPACE SETTINGS</p>
          <h1>Notifications</h1>
          <p className="muted">
            Manage verified recipients for incident and recovery emails.
          </p>
        </div>
      </div>
      {!selected || !initial ? (
        <p>
          Create a workspace before adding recipients.{' '}
          <Link href="/app/organizations">Workspaces</Link>
        </p>
      ) : (
        <>
          <form className="directory-toolbar" action="/app/notifications">
            <label htmlFor="notification-workspace">Workspace</label>
            <select
              id="notification-workspace"
              name="workspace"
              defaultValue={selected.id}
            >
              {organizations.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
            </select>
            <button className="secondary">Open workspace</button>
          </form>
          <NotificationSettings
            key={selected.id}
            organizationId={selected.id}
            initial={initial}
          />
        </>
      )}
    </main>
  );
}
