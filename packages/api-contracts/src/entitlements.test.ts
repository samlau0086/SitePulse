import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { entitlementChange } from './index';

const input = {
  organizationId: randomUUID(),
  planCode: 'free',
  siteLimitOverride: null,
  operator: 'operator-label',
  reason: 'Pilot allocation',
};
it('requires explicit, bounded operator entitlement inputs', () => {
  expect(entitlementChange.parse(input)).toEqual(input);
  for (const patch of [
    { organizationId: 'invalid' },
    { planCode: 'enterprise' },
    { siteLimitOverride: -1 },
    { siteLimitOverride: 1001 },
    { siteLimitOverride: 1.5 },
    { siteLimitOverride: undefined },
    { operator: ' ' },
    { reason: ' ' },
    { ownerUserId: randomUUID() },
  ]) {
    expect(entitlementChange.safeParse({ ...input, ...patch }).success).toBe(
      false,
    );
  }
});
