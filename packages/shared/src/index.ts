export const membershipRoles = ['owner', 'admin', 'member'] as const;
export type MembershipRole = (typeof membershipRoles)[number];
export function canManageOrganization(role: MembershipRole) {
  return role === 'owner' || role === 'admin';
}
