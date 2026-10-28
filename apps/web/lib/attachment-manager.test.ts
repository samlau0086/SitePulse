import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import type { AttachmentDirectory } from '@sitepulse/api-contracts';
import { AttachmentManager } from '../components/attachment-manager';

function fixture(canManage: boolean): AttachmentDirectory {
  return {
    canManage,
    usedBytes: 3072,
    limitBytes: 64 * 1024 * 1024,
    attachments: [
      {
        id: '11111111-1111-4111-8111-111111111111',
        kind: 'plugin',
        slug: 'clean-plugin',
        name: 'Clean Plugin',
        version: '1.0.0',
        sha256: 'a'.repeat(64),
        byteSize: 1024,
        scan: {
          version: 'sitepulse-static-1',
          status: 'complete',
          scannedFiles: 1,
          findings: [],
        },
        createdAt: '2026-10-28T00:00:00Z',
      },
      {
        id: '22222222-2222-4222-8222-222222222222',
        kind: 'theme',
        slug: 'blocked-theme',
        name: 'Blocked Theme',
        version: '2.0.0',
        sha256: 'b'.repeat(64),
        byteSize: 2048,
        scan: {
          version: 'sitepulse-static-1',
          status: 'blocked',
          scannedFiles: 2,
          findings: [{ rule: 'encoded_eval', path: 'blocked-theme/main.php' }],
        },
        createdAt: '2026-10-28T00:00:00Z',
      },
    ],
  };
}

it('shows reusable clean packages, blocks risky installs, and never calls a clean scan safe', () => {
  const html = renderToStaticMarkup(
    createElement(AttachmentManager, {
      organizationId: 'workspace-fixture',
      initial: fixture(true),
    }),
  );
  expect(html).toContain('Scan complete: no patterns detected');
  expect(html).toContain('Blocked: risk found');
  expect(html).toContain('does not prove safety');
  expect(html).toContain('detected automatically from the ZIP root directory');
  expect(html).not.toContain('name="slug"');
  expect(html).toContain(
    '/app/software?workspace=workspace-fixture&amp;attachment=11111111-1111-4111-8111-111111111111',
  );
  expect(html).not.toContain(
    '/app/software?workspace=workspace-fixture&amp;attachment=22222222-2222-4222-8222-222222222222',
  );
});

it('keeps attachment mutations disabled for read-only members', () => {
  const html = renderToStaticMarkup(
    createElement(AttachmentManager, {
      organizationId: 'workspace-fixture',
      initial: fixture(false),
    }),
  );
  expect(html).toContain('<fieldset disabled="">');
  expect(html).toContain('administrator access is required');
  expect(html).not.toContain('Choose sites &amp; install');
});
