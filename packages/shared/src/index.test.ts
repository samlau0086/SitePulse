import { expect, it } from 'vitest';
import { canManageOrganization } from './index';
it('reserves management for owners and admins', () => {
  expect(canManageOrganization('owner')).toBe(true);
  expect(canManageOrganization('admin')).toBe(true);
  expect(canManageOrganization('member')).toBe(false);
});
