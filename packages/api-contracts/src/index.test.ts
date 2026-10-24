import { expect, it } from 'vitest';
import { registration, createOrganization, connectorInventory } from './index';

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

it('accepts bounded minimized inventory and rejects oversized entries', () => {
  const valid = connectorInventory.parse({
    siteId: '00000000-0000-4000-8000-000000000001',
    wordpressVersion: '6.7.1',
    phpVersion: '8.3.4',
    activePlugins: [
      { identifier: 'seo-plugin', name: 'SEO Plugin', version: '1.2.0' },
    ],
    activeThemes: [
      {
        identifier: 'twentytwentyfive',
        name: 'Twenty Twenty-Five',
        version: '1.0.0',
      },
    ],
    updateCounts: { plugins: 1, themes: 0, core: 0 },
  });
  expect(valid.activePlugins).toHaveLength(1);
  expect(
    connectorInventory.safeParse({
      ...valid,
      activePlugins: Array.from({ length: 201 }, () => valid.activePlugins[0]),
    }).success,
  ).toBe(false);
  expect(
    connectorInventory.safeParse({ ...valid, wordpressVersion: 'latest' })
      .success,
  ).toBe(false);
});
