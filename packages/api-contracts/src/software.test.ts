import { expect, it } from 'vitest';
import {
  softwareCommand,
  softwarePreview,
  softwareResult,
  inventorySync,
  inventoryFailure,
} from './software';
import { randomUUID } from 'node:crypto';

it('bounds inventory sync requests and rejects raw failure diagnostics', () => {
  const siteId = randomUUID();
  expect(inventorySync.safeParse({ siteId }).success).toBe(true);
  expect(
    inventorySync.safeParse({ siteId, userId: randomUUID() }).success,
  ).toBe(false);
  expect(
    inventoryFailure.safeParse({
      siteId,
      code: 'collection',
      inventoryRequestId: randomUUID(),
    }).success,
  ).toBe(true);
  expect(inventoryFailure.safeParse({ siteId, code: 'ok' }).success).toBe(
    false,
  );
  expect(
    inventoryFailure.safeParse({
      siteId,
      code: 'collection',
      message: '/secret/path',
    }).success,
  ).toBe(false);
});

it('allows only bounded official slugs and explicit supported commands', () => {
  for (const slug of [
    '../plugin',
    'https://example.com/a.zip',
    'plugin/file.php',
    'A_B',
    'a%2fb',
    'a'.repeat(101),
  ]) {
    expect(
      softwareCommand.safeParse({ kind: 'plugin', action: 'install', slug })
        .success,
    ).toBe(false);
  }
  expect(
    softwareCommand.parse({
      kind: 'plugin',
      action: 'install',
      slug: 'wordpress-seo',
    }).slug,
  ).toBe('wordpress-seo');
  expect(
    softwareCommand.safeParse({ kind: 'plugin', action: 'shell', slug: 'a' })
      .success,
  ).toBe(false);
  expect(
    softwareCommand.safeParse({
      kind: 'plugin',
      action: 'install',
      slug: 'a',
      package: 'https://example.com',
    }).success,
  ).toBe(false);
});
it('requires a different replacement theme and bounds batch scope', () => {
  expect(
    softwareCommand.safeParse({
      kind: 'theme',
      action: 'deactivate',
      slug: 'a',
    }).success,
  ).toBe(false);
  expect(
    softwareCommand.safeParse({
      kind: 'theme',
      action: 'deactivate',
      slug: 'a',
      replacement: 'a',
    }).success,
  ).toBe(false);
  expect(
    softwareCommand.safeParse({
      kind: 'theme',
      action: 'deactivate',
      slug: 'a',
      replacement: 'b',
    }).success,
  ).toBe(true);
  const id = randomUUID();
  const input = {
    command: { kind: 'plugin', action: 'update', slug: 'a' },
    reason: 'Security update',
  };
  for (const siteIds of [
    [],
    [id, id],
    Array.from({ length: 21 }, randomUUID),
  ]) {
    expect(softwarePreview.safeParse({ ...input, siteIds }).success).toBe(
      false,
    );
  }
});
it('accepts sanitized result codes, not arbitrary plugin output', () => {
  const input = {
    siteId: randomUUID(),
    operationId: randomUUID(),
    token: 'a'.repeat(43),
  };
  expect(softwareResult.safeParse({ ...input, code: 'ok' }).success).toBe(true);
  expect(
    softwareResult.safeParse({
      ...input,
      code: 'Error contains /secret-path/password',
    }).success,
  ).toBe(false);
});
