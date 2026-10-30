// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AttachmentDirectory } from '@sitepulse/api-contracts';
import { AttachmentManager } from '../components/attachment-manager';
import { api } from './api';

vi.mock('./api', () => ({ api: vi.fn() }));
const request = vi.mocked(api);
let root: Root;
let host: HTMLDivElement;

function fixture(): AttachmentDirectory {
  return {
    canManage: true,
    usedBytes: 0,
    limitBytes: 64 * 1024 * 1024,
    attachments: [],
  };
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  request.mockReset();
  request.mockResolvedValue(fixture());
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ reused: false }),
    }),
  );
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function mount(initial = fixture()) {
  await act(async () =>
    root.render(
      createElement(AttachmentManager, {
        organizationId: 'workspace',
        initial,
        initialDrive: { enabled: true, connected: true },
      }),
    ),
  );
}

function drop(files: File[]) {
  const event = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', {
    value: {
      files: {
        length: files.length,
        item: (index: number) => files[index] ?? null,
      },
    },
  });
  return event;
}

function uploadButton() {
  const result = [...host.querySelectorAll('button')].find(
    (button) => button.textContent?.trim() === 'Upload and scan',
  );
  expect(result).toBeDefined();
  return result!;
}

it('accepts a dropped ZIP, displays it, and uploads only after explicit submission', async () => {
  await mount();
  const file = new File(['package'], 'my-plugin.zip', {
    type: 'application/zip',
  });
  const target = host.querySelector('.attachment-dropzone')!;

  await act(async () => target.dispatchEvent(drop([file])));

  expect(host.textContent).toContain('my-plugin.zip');
  expect(host.textContent).toContain('1 KiB selected. Click to replace.');
  expect(uploadButton().disabled).toBe(false);
  expect(fetch).not.toHaveBeenCalled();

  await act(async () => uploadButton().click());

  expect(fetch).toHaveBeenCalledWith(
    '/api/v1/organizations/workspace/attachments/plugin',
    expect.objectContaining({
      method: 'POST',
      headers: { 'Content-Type': 'application/zip' },
      body: file,
    }),
  );
  expect(host.textContent).toContain('Package inspected and saved');
  expect(host.textContent).toContain('Drag and drop a ZIP package here');
  expect(uploadButton().disabled).toBe(true);
});

it('rejects non-ZIP and multiple-file drops before any upload request', async () => {
  await mount();
  const target = host.querySelector('.attachment-dropzone')!;

  await act(async () =>
    target.dispatchEvent(drop([new File(['text'], 'readme.txt')])),
  );
  expect(host.textContent).toContain('Choose a file with a .zip extension.');
  expect(uploadButton().disabled).toBe(true);

  await act(async () =>
    target.dispatchEvent(
      drop([new File(['one'], 'one.zip'), new File(['two'], 'two.zip')]),
    ),
  );
  expect(host.textContent).toContain('Drop one ZIP package at a time.');
  expect(fetch).not.toHaveBeenCalled();
});

it('warns about permanent Drive deletion, honors cancellation and retains entries after failure', async () => {
  const initial = fixture();
  initial.attachments.push({
    id: '11111111-1111-4111-8111-111111111111',
    storage: 'google_drive',
    kind: 'plugin',
    slug: 'sample',
    name: 'Sample Plugin',
    version: '1.0',
    sha256: 'a'.repeat(64),
    byteSize: 1024,
    scan: {
      version: 'sitepulse-static-1',
      status: 'complete',
      scannedFiles: 1,
      findings: [],
    },
    createdAt: '2026-10-30T00:00:00Z',
  });
  await mount(initial);
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  const button = [...host.querySelectorAll('button')].find(
    (item) => item.textContent === 'Delete',
  )!;
  await act(async () => button.click());
  expect(confirm).toHaveBeenCalledWith(
    expect.stringContaining('permanently deletes the original file'),
  );
  expect(request).not.toHaveBeenCalled();
  confirm.mockReturnValue(true);
  request.mockRejectedValueOnce(
    new Error(
      'Could not delete the original Google Drive file. The attachment record was kept.',
    ),
  );
  await act(async () => button.click());
  expect(request).toHaveBeenCalledWith(
    '/organizations/workspace/attachments/11111111-1111-4111-8111-111111111111',
    {},
    'DELETE',
  );
  expect(host.querySelector('[role="alert"]')?.textContent).toContain(
    'attachment record was kept',
  );
  expect(host.textContent).toContain('Sample Plugin');
  request
    .mockResolvedValueOnce({ success: true })
    .mockResolvedValueOnce(fixture());
  await act(async () => button.click());
  expect(host.textContent).toContain('Attachment deleted.');
  expect(host.textContent).not.toContain('Sample Plugin');
});
