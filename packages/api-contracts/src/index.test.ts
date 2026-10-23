import { expect, it } from 'vitest';
import { registration, createOrganization } from './index';

it('normalizes email and rejects short passwords and privilege injection', () => {
  expect(
    registration.parse({
      name: 'Sam',
      email: 'SAM@EXAMPLE.COM',
      password: 'long passphrase here',
    }).email,
  ).toBe('sam@example.com');
  expect(
    registration.safeParse({
      name: 'Sam',
      email: 'sam@example.com',
      password: 'short',
    }).success,
  ).toBe(false);
  expect(
    createOrganization.safeParse({
      name: 'A',
      slug: 'abc',
      planCode: 'agency',
      ownerUserId: 'attacker',
    }).success,
  ).toBe(false);
});
