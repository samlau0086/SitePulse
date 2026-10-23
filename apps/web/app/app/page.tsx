import Link from 'next/link';
import type { Organization } from '@sitepulse/api-contracts';
import { serverApi } from '../../lib/server-api';
import {
  CreateOrganizationForm,
  LogoutButton,
} from '../../components/workspace-actions';

export default async function WorkspacePage() {
  const [{ user }, { organizations }] = await Promise.all([
    serverApi<{ user: { name: string; emailVerified: boolean } }>(
      '/auth/session',
    ),
    serverApi<{ organizations: Organization[] }>('/organizations'),
  ]);
  return (
    <main>
      <h1>{user.name}’s workspace</h1>
      {!user.emailVerified && (
        <p>
          <Link href="/verify-email">Verify your email</Link> before connecting
          a WordPress site.
        </p>
      )}
      <p className="muted">Your organizations</p>
      {organizations.length ? (
        <ul>
          {organizations.map((organization) => (
            <li key={organization.id}>
              <Link href={`/app/organizations/${organization.id}`}>
                {organization.name}
              </Link>{' '}
              — {organization.role}
            </li>
          ))}
        </ul>
      ) : (
        <p>Create your first organization to get started.</p>
      )}
      <CreateOrganizationForm />
      <LogoutButton />
    </main>
  );
}
