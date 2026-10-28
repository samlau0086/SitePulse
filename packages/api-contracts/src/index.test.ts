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
    installedPlugins: [
      {
        identifier: 'seo-plugin',
        name: 'SEO Plugin',
        version: '1.2.0',
        active: true,
        updateVersion: '1.3.0',
        source: 'wordpress.org',
      },
    ],
    installedThemes: [],
    environment: {
      environmentType: 'production',
      multisite: false,
      wpDebug: false,
      wpDebugDisplay: false,
      scriptDebug: false,
      disallowFileEdit: true,
      forceSslAdmin: true,
      wpCronDisabled: false,
    },
    localSecurityScan: {
      status: 'complete',
      scannedFiles: 40,
      skippedFiles: 0,
      findings: [],
    },
    updateCounts: { plugins: 1, themes: 0, core: 0 },
  });
  expect(valid.activePlugins).toHaveLength(1);
  expect(valid.installedPlugins?.[0]?.active).toBe(true);
  for (const path of [
    '/etc/passwd',
    '../secret.php',
    'plugins/../../secret.php',
    'C:\\secret.php',
    'uploads/line\n.php',
  ]) {
    expect(
      connectorInventory.safeParse({
        ...valid,
        localSecurityScan: {
          status: 'complete',
          scannedFiles: 1,
          skippedFiles: 0,
          findings: [{ rule: 'php_in_uploads', path }],
        },
      }).success,
    ).toBe(false);
  }
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
  expect(
    connectorInventory.safeParse({
      ...valid,
      localSecurityScan: {
        ...valid.localSecurityScan,
        findings: [{ rule: 'arbitrary_code', path: 'plugin.php' }],
      },
    }).success,
  ).toBe(false);
});
