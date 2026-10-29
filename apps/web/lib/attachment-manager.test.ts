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

it('uses personal Drive exclusively and keeps remote-original retention guidance', () => {
  const initial = fixture(true);
  initial.attachments[0]!.storage = 'google_drive';
  const html = renderToStaticMarkup(
    createElement(AttachmentManager, {
      organizationId: 'workspace-fixture',
      initial,
      initialDrive: { enabled: true, connected: true },
      driveResult: 'error',
    }),
  );
  expect(html).toContain('Reconnect Google Drive');
  expect(html).not.toContain('name="storage"');
  expect(html).not.toContain('value="database"');
  expect(html).toContain('New packages are stored only in your Google Drive');
  expect(html).toContain('Drag and drop a ZIP package here');
  expect(html).toContain('or click to choose a file · maximum 8 MiB');
  expect(html).toContain('Upload and scan</button>');
  expect(html).not.toContain('<fieldset disabled="">');
  expect(html).toContain('Uploader’s Google Drive');
  expect(html).toContain('Drive originals are kept');
  expect(html).toContain('Google Drive connection failed');
});

it('requires a Drive connection before enabling uploads', () => {
  const html = renderToStaticMarkup(
    createElement(AttachmentManager, {
      organizationId: 'workspace-fixture',
      initial: fixture(true),
      initialDrive: { enabled: true, connected: false },
    }),
  );
  expect(html).toContain('<fieldset disabled="">');
  expect(html).toContain('Connect Google Drive before uploading a package');
  expect(html).not.toContain('name="storage"');
});
