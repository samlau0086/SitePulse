import { cache } from 'react';
import type {
  Incident,
  Organization,
  Site,
  OrganizationUsage,
} from '@sitepulse/api-contracts';
import { serverApi } from './server-api';

export const workspaceSession = cache(() =>
  serverApi<{ user: { name: string; email: string; emailVerified: boolean } }>(
    '/auth/session',
  ),
);
export const workspaceOrganizations = cache(() =>
  serverApi<{ organizations: Organization[] }>('/organizations'),
);
export const workspaceUsage = cache((organizationId: string) =>
  serverApi<{ usage: OrganizationUsage }>(
    `/organizations/${organizationId}/usage`,
  ),
);
export const workspaceData = cache(async () => {
  const { organizations } = await workspaceOrganizations();
  const sites: Site[] = [];
  const incidents: Incident[] = [];
  // Each endpoint checks membership; bound concurrent requests across organizations.
  for (let offset = 0; offset < organizations.length; offset += 4) {
    const batches = await Promise.all(
      organizations.slice(offset, offset + 4).map(async (organization) => {
        const [siteResult, incidentResult] = await Promise.all([
          serverApi<{ sites: Site[] }>(
            `/organizations/${organization.id}/sites`,
          ),
          serverApi<{ incidents: Incident[] }>(
            `/organizations/${organization.id}/incidents`,
          ),
        ]);
        return { ...siteResult, ...incidentResult };
      }),
    );
    for (const batch of batches) {
      sites.push(...batch.sites);
      incidents.push(...batch.incidents);
    }
  }
  incidents.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  return { organizations, sites, incidents };
});
