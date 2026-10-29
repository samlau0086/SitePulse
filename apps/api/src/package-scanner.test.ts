import { expect, it } from 'vitest';
import { scanPackage, codeFindings, PACKAGE_LIMIT } from './package-scanner';
import { packageFixture, pluginFixture } from './package-fixture';

it('detects the root slug from archive entries without a declared slug', async () => {
  expect(await scanPackage(pluginFixture(), 'plugin')).toMatchObject({
    slug: 'sample',
  });
  const theme = packageFixture([
    { path: 'custom-theme/', content: '' },
    {
      path: 'custom-theme/style.css',
      content: '/*\nTheme Name: Custom\nVersion: 1.0\n*/',
    },
  ]);
  expect(await scanPackage(theme, 'theme')).toMatchObject({
    slug: 'custom-theme',
    name: 'Custom',
  });
});

it.each(['other-root', 'Invalid_Root', 'sitepulse-connector'])(
  'rejects ambiguous or disallowed inferred roots: %s',
  async (root) => {
    const files = [
      {
        path: `${root}/main.php`,
        content: '<?php\n/*\nPlugin Name: Test\nVersion: 1.0\n*/',
      },
    ];
    if (root === 'other-root')
      files.unshift({ path: 'sample/readme.txt', content: 'metadata' });
    await expect(
      scanPackage(packageFixture(files), 'plugin'),
    ).rejects.toThrow();
  },
);

it('inspects WordPress plugin and theme headers and immutable digest', async () => {
  const result = await scanPackage(pluginFixture(), 'plugin', 'sample');
  expect(result).toMatchObject({
    name: 'Sample',
    version: '1.2.3',
    scan: { status: 'complete', scannedFiles: 1, findings: [] },
  });
  expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
  expect(
    (
      await scanPackage(
        packageFixture([
          {
            path: 'sample/style.css',
            content: '/*\nTheme Name: Sample\nVersion: 2.0\n*/',
          },
        ]),
        'theme',
        'sample',
      )
    ).version,
  ).toBe('2.0');
});
it('accepts ZIP entries without Unix mode bits', async () => {
  await expect(
    scanPackage(
      packageFixture([
        {
          path: 'sample/main.php',
          mode: 0,
          content: '<?php\n/* Plugin Name: Sample\nVersion: 1.0 */',
        },
      ]),
      'plugin',
    ),
  ).resolves.toMatchObject({ slug: 'sample', name: 'Sample', version: '1.0' });
});
it('finds a plugin header in a nested PHP file', async () => {
  await expect(
    scanPackage(
      packageFixture([
        {
          path: 'sample/includes/main.php',
          content: '<?php\n/* Plugin Name: Sample\nVersion: 1.0 */',
        },
      ]),
      'plugin',
    ),
  ).resolves.toMatchObject({ slug: 'sample', name: 'Sample', version: '1.0' });
});
it('prefers the unique root plugin header over nested PHP metadata', async () => {
  await expect(
    scanPackage(
      packageFixture([
        {
          path: 'sample/main.php',
          content: '<?php\n/* Plugin Name: Sample\nVersion: 1.0 */',
        },
        {
          path: 'sample/vendor/example.php',
          content: '<?php\n/* Plugin Name: Example\nVersion: 9.9 */',
        },
      ]),
      'plugin',
    ),
  ).resolves.toMatchObject({ slug: 'sample', name: 'Sample', version: '1.0' });
});
it.each([
  '../escape.php',
  'sample/../escape.php',
  '/sample/a.php',
  'sample\\a.php',
  'other/a.php',
  'sample/a.php.',
  'sample//a.php',
])('rejects unsafe paths: %s', async (path) => {
  await expect(
    scanPackage(packageFixture([{ path, content: 'x' }]), 'plugin', 'sample'),
  ).rejects.toThrow();
});
it('rejects duplicate, case-colliding, symlink, encrypted, corrupt and oversized entries', async () => {
  const entry = { path: 'sample/main.php', content: 'x' };
  for (const files of [
    [entry, entry],
    [entry, { ...entry, path: 'sample/MAIN.php' }],
    [{ ...entry, mode: 0xa1ff }],
    [{ ...entry, flags: 1 }],
    [{ ...entry, crc: 123 }],
    [{ ...entry, content: 'x'.repeat(2 * 1024 * 1024 + 1) }],
  ]) {
    await expect(
      scanPackage(packageFixture(files), 'plugin', 'sample'),
    ).rejects.toThrow();
  }
});
it('rejects parser-confusion archives before reading package code', async () => {
  await expect(
    scanPackage(
      packageFixture([
        { path: 'sample/', content: 'hidden' },
        {
          path: 'sample/main.php',
          content: '<?php /* Plugin Name: Sample\nVersion: 1.0 */',
        },
      ]),
      'plugin',
      'sample',
    ),
  ).rejects.toThrow();
  await expect(
    scanPackage(
      packageFixture([
        {
          path: 'sample/main.php',
          content: '<?php /* Plugin Name: Sample\nVersion: 1.0 */',
          localCrc: 123,
        },
      ]),
      'plugin',
      'sample',
    ),
  ).rejects.toThrow();
  await expect(
    scanPackage(
      packageFixture([
        {
          path: 'sample/main.php',
          content: '<?php /* Plugin Name: Sample\nVersion: 1.0 */',
          localSize: 1,
        },
      ]),
      'plugin',
      'sample',
    ),
  ).rejects.toThrow();
  await expect(
    scanPackage(
      packageFixture([
        { path: 'sample/file', content: 'x' },
        {
          path: 'sample/file/main.php',
          content: '<?php /* Plugin Name: Sample\nVersion: 1.0 */',
        },
      ]),
      'plugin',
      'sample',
    ),
  ).rejects.toThrow();
});
it('blocks suspicious code, disguised PHP and embedded archives', async () => {
  expect(
    (
      await scanPackage(
        pluginFixture('eval(base64_decode("fixture"));'),
        'plugin',
        'sample',
      )
    ).scan.status,
  ).toBe('blocked');
  const result = await scanPackage(
    packageFixture([
      {
        path: 'sample/main.php',
        content: '<?php\n/*\nPlugin Name: Sample\nVersion: 1.0\n*/',
      },
      { path: 'sample/image.txt', content: '<?php eval($_POST["x"]);' },
      { path: 'sample/extra.zip', content: 'x' },
    ]),
    'plugin',
    'sample',
  );
  expect(result.scan.findings.map((row) => row.rule)).toEqual([
    'request_eval',
    'embedded_executable_or_archive',
  ]);
});
it('rejects malformed, wrong-kind, oversized and Connector packages', async () => {
  for (const bytes of [
    Buffer.from('not a zip'),
    Buffer.alloc(PACKAGE_LIMIT + 1),
  ])
    await expect(scanPackage(bytes, 'plugin', 'sample')).rejects.toThrow();
  await expect(
    scanPackage(pluginFixture(), 'theme', 'sample'),
  ).rejects.toThrow();
  await expect(
    scanPackage(pluginFixture(), 'plugin', 'sitepulse-connector'),
  ).rejects.toThrow();
});
it('detects bounded PHP and JavaScript patterns without returning code', () => {
  expect(codeFindings('system($_GET["x"]);')).toContain('command_execution');
  expect(codeFindings('eval(atob("fixture"))')).toContain('encoded_javascript');
  expect(codeFindings('<?php echo "hello";')).toEqual([]);
});
