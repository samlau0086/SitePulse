import type { OrganizationUsage } from '@sitepulse/api-contracts';

const names = {
  free: 'Free',
  pro: 'Pro',
  agency: 'Agency',
  agency_plus: 'Agency Plus',
};

export function PlanUsage({ usage }: { usage: OrganizationUsage }) {
  return (
    <div aria-label="Workspace plan and usage">
      <p>
        {names[usage.planCode]} · {usage.sitesUsed} / {usage.siteLimit} sites
        {usage.siteLimitOverride !== null ? ' · Custom allowance' : ''}
      </p>
      {!usage.canAddSite ? (
        <p role="status" className="notice-warning">
          [!] {usage.overLimit ? 'Over site limit.' : 'Site limit reached.'}{' '}
          Existing sites continue monitoring. Delete a site or contact your
          operator to adjust your allowance.
        </p>
      ) : (
        <p className="muted">{usage.sitesRemaining} site slots available.</p>
      )}
    </div>
  );
}
