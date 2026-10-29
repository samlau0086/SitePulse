'use client';
import { Timestamp } from './user-preferences';
import Link from 'next/link';
import { useRef, useState } from 'react';
import type {
  AttachmentDirectory,
  DriveConnection,
} from '@sitepulse/api-contracts';
import { api } from '../lib/api';
import { Icon } from './icon';

const MAX_PACKAGE_BYTES = 8 * 1024 * 1024;

function packageError(file: File | null) {
  if (!file) return 'Choose a ZIP package.';
  if (!file.name.toLowerCase().endsWith('.zip'))
    return 'Choose a file with a .zip extension.';
  if (!file.size || file.size > MAX_PACKAGE_BYTES)
    return 'Choose a ZIP no larger than 8 MiB.';
  return '';
}

export function AttachmentManager({
  organizationId,
  initial,
  initialDrive = { enabled: false, connected: false },
  driveResult,
}: {
  organizationId: string;
  initial: AttachmentDirectory;
  initialDrive?: DriveConnection;
  driveResult?: string;
}) {
  const [data, setData] = useState(initial);
  const [drive, setDrive] = useState(initialDrive);
  const [pending, setPending] = useState(false);
  const [selectedPackage, setSelectedPackage] = useState<File | null>(null);
  const [draggingPackage, setDraggingPackage] = useState(false);
  const dragDepth = useRef(0);
  const [error, setError] = useState(
    driveResult === 'error'
      ? 'Google Drive connection failed. Try again with the Google account matching your SitePulse email.'
      : '',
  );
  const [message, setMessage] = useState(
    driveResult === 'connected'
      ? 'Google account linked. Drive uploads require offline file access; reconnect if unavailable.'
      : '',
  );
  const base = `/organizations/${organizationId}/attachments`;
  const uploadDisabled = pending || !data.canManage || !drive.connected;
  function choosePackage(file: File | null) {
    const validationError = packageError(file);
    if (validationError) {
      setSelectedPackage(null);
      setError(validationError);
      return;
    }
    setSelectedPackage(file);
    setError('');
  }
  async function run(work: () => Promise<void>) {
    setPending(true);
    setError('');
    setMessage('');
    try {
      await work();
      setData(await api<AttachmentDirectory>(base, undefined, 'GET'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed.');
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="attachment-manager">
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      <section className="card">
        <h2>My Google Drive</h2>
        <p>
          {drive.connected
            ? 'Connected'
            : drive.enabled
              ? 'Not connected'
              : 'Google Drive is not configured on this server.'}
        </p>
        <p>
          Connect the Google account matching your SitePulse email. Only files
          created or selected for SitePulse are accessible. Packages remain
          private in your Drive and are shared through workspace permissions.
        </p>
        <p>
          Disconnecting prevents future downloads of your Drive packages.
          Existing WordPress installations and Drive originals are kept.
          Reconnect the same account to restore access.
        </p>
        <div className="software-actions">
          <button
            className="secondary"
            disabled={pending || !drive.enabled || !data.canManage}
            onClick={() =>
              void run(async () => {
                const result = await api<{ url: string }>(
                  '/me/google-drive/connect',
                  {},
                );
                window.location.assign(result.url);
              })
            }
          >
            {drive.connected
              ? 'Reconnect Google Drive'
              : 'Connect Google Drive'}
          </button>
          {drive.connected && (
            <button
              className="secondary danger"
              disabled={pending || !data.canManage}
              onClick={() => {
                if (
                  window.confirm(
                    'Disconnect your Google Drive? Future installations using your Drive packages will fail until you reconnect the same account. Original files are kept.',
                  )
                )
                  void run(async () => {
                    await api('/me/google-drive', undefined, 'DELETE');
                    setDrive(
                      await api<DriveConnection>(
                        '/me/google-drive',
                        undefined,
                        'GET',
                      ),
                    );
                    setMessage(
                      'Google Drive disconnected. Original files are kept.',
                    );
                  });
              }}
            >
              Disconnect
            </button>
          )}
        </div>
      </section>
      <section className="card">
        <h2>
          <Icon name="up" /> Upload package
        </h2>
        <p>
          {(data.usedBytes / 1048576).toFixed(1)} / {data.limitBytes / 1048576}{' '}
          MiB used. Maximum 8 MiB per ZIP, 100 packages per workspace.
        </p>
        <p className="notice-warning">
          Static scanning detects selected suspicious patterns, not every
          backdoor or vulnerability. No findings does not prove safety. Only
          upload packages from trusted sources. Packages with findings cannot be
          installed.
        </p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const fields = new FormData(form);
            const validationError = packageError(selectedPackage);
            if (validationError || !selectedPackage) {
              setError(validationError);
              return;
            }
            void run(async () => {
              const response = await fetch(
                `/api/v1${base}/${fields.get('kind')}`,
                {
                  method: 'POST',
                  credentials: 'same-origin',
                  headers: { 'Content-Type': 'application/zip' },
                  body: selectedPackage,
                },
              );
              const result = await response.json();
              if (!response.ok)
                throw new Error(result.error?.message ?? 'Upload failed.');
              form.reset();
              setSelectedPackage(null);
              setMessage(
                result.reused
                  ? 'This package is already in the library.'
                  : 'Package inspected and saved. Review the scan result below.',
              );
            });
          }}
        >
          <fieldset disabled={uploadDisabled}>
            <p>
              New packages are stored only in your Google Drive. SitePulse keeps
              metadata and scan results. Identical ZIPs reuse the existing
              library entry, including legacy packages.
            </p>
            <label htmlFor="attachment-kind">Package type</label>
            <select name="kind" id="attachment-kind">
              <option value="plugin">Plugin</option>
              <option value="theme">Theme</option>
            </select>
            <p>
              The folder slug is detected automatically from the ZIP root
              directory during scanning.
            </p>
            <label
              className={`attachment-dropzone${draggingPackage ? ' is-dragging' : ''}${selectedPackage ? ' has-file' : ''}`}
              htmlFor="attachment-package"
              onDragEnter={(event) => {
                event.preventDefault();
                if (uploadDisabled) return;
                dragDepth.current += 1;
                setDraggingPackage(true);
              }}
              onDragOver={(event) => {
                event.preventDefault();
                if (uploadDisabled) return;
                event.dataTransfer.dropEffect = 'copy';
              }}
              onDragLeave={(event) => {
                event.preventDefault();
                if (uploadDisabled) return;
                dragDepth.current = Math.max(0, dragDepth.current - 1);
                if (!dragDepth.current) setDraggingPackage(false);
              }}
              onDrop={(event) => {
                event.preventDefault();
                dragDepth.current = 0;
                setDraggingPackage(false);
                if (uploadDisabled) return;
                if (event.dataTransfer.files.length !== 1) {
                  setSelectedPackage(null);
                  setError('Drop one ZIP package at a time.');
                  return;
                }
                choosePackage(event.dataTransfer.files.item(0));
              }}
            >
              <input
                id="attachment-package"
                name="package"
                type="file"
                accept=".zip,application/zip"
                aria-describedby="attachment-package-help"
                onChange={(event) => {
                  choosePackage(event.currentTarget.files?.item(0) ?? null);
                  if (!event.currentTarget.files?.length)
                    event.currentTarget.value = '';
                }}
              />
              <span className="attachment-dropzone-icon" aria-hidden="true">
                <Icon name="up" />
              </span>
              <span className="attachment-dropzone-title">
                {selectedPackage
                  ? selectedPackage.name
                  : draggingPackage
                    ? 'Drop ZIP package here'
                    : 'Drag and drop a ZIP package here'}
              </span>
              <span
                className="attachment-dropzone-help"
                id="attachment-package-help"
              >
                {selectedPackage
                  ? `${Math.ceil(selectedPackage.size / 1024)} KiB selected. Click to replace.`
                  : 'or click to choose a file · maximum 8 MiB'}
              </span>
            </label>
            <button disabled={!selectedPackage}>
              {pending ? 'Working…' : 'Upload and scan'}
            </button>
          </fieldset>
        </form>
        {data.canManage && !drive.connected && (
          <p>Connect Google Drive before uploading a package.</p>
        )}
        {!data.canManage && (
          <p>
            Verified workspace administrator access is required to manage
            attachments.
          </p>
        )}
      </section>
      <section className="card">
        <h2>
          <Icon name="overview" /> Package library
        </h2>
        {!data.attachments.length && (
          <p>
            No packages yet. Upload a plugin or theme ZIP to reuse it across
            your sites.
          </p>
        )}
        <div className="software-catalog">
          {data.attachments.map((item) => (
            <article className="software-component" key={item.id}>
              <div className="software-component-title">
                <span className="software-artwork">
                  <Icon
                    name={item.kind === 'plugin' ? 'connection' : 'overview'}
                  />
                </span>
                <div>
                  <h3>{item.name}</h3>
                  <small>
                    {item.kind} · {item.slug} · v{item.version}
                  </small>
                </div>
              </div>
              <p
                className={`status-badge ${item.scan.status === 'blocked' ? 'warning' : ''}`}
              >
                <Icon name="shield" />
                {item.scan.status === 'blocked'
                  ? 'Blocked: risk found'
                  : 'Scan complete: no patterns detected'}
              </p>
              <p className="muted">
                {item.storage === 'google_drive'
                  ? 'Uploader’s Google Drive'
                  : 'Legacy SitePulse storage'}{' '}
                · {item.scan.scannedFiles} code files ·{' '}
                {Math.ceil(item.byteSize / 1024)} KiB ·{' '}
                <Timestamp value={item.createdAt} />
              </p>
              <details>
                <summary>Scan details and fingerprint</summary>
                <p className="attachment-digest">SHA-256: {item.sha256}</p>
                <p>Scanner: {item.scan.version}</p>
                {item.scan.findings.map((finding, index) => (
                  <p className="attachment-digest" key={index}>
                    {finding.rule} · {finding.path}
                  </p>
                ))}
              </details>
              <div className="software-actions">
                {data.canManage && item.scan.status === 'complete' && (
                  <Link
                    className="button secondary"
                    href={`/app/software?workspace=${organizationId}&attachment=${item.id}`}
                  >
                    Choose sites & install →
                  </Link>
                )}
                <button
                  className="secondary danger"
                  disabled={pending || !data.canManage}
                  onClick={() => {
                    if (
                      window.confirm(
                        `Delete ${item.name} v${item.version} from this workspace library? Installed sites are unaffected.${item.storage === 'google_drive' ? ' The original Google Drive file is kept.' : ''}`,
                      )
                    )
                      void run(async () => {
                        await api(`${base}/${item.id}`, undefined, 'DELETE');
                        setMessage('Attachment deleted.');
                      });
                  }}
                >
                  Delete
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
