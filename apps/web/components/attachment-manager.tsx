'use client';
import { Timestamp } from './user-preferences';
import Link from 'next/link';
import { useState } from 'react';
import type {
  AttachmentDirectory,
  DriveConnection,
} from '@sitepulse/api-contracts';
import { api } from '../lib/api';
import { Icon } from './icon';

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
            const file = fields.get('package');
            if (!(file instanceof File) || !file.size || file.size > 8388608) {
              setError('Choose a ZIP no larger than 8 MiB.');
              return;
            }
            void run(async () => {
              const response = await fetch(
                `/api/v1${base}/${fields.get('kind')}?storage=${fields.get('storage')}`,
                {
                  method: 'POST',
                  credentials: 'same-origin',
                  headers: { 'Content-Type': 'application/zip' },
                  body: file,
                },
              );
              const result = await response.json();
              if (!response.ok)
                throw new Error(result.error?.message ?? 'Upload failed.');
              form.reset();
              setMessage(
                result.reused
                  ? 'This package is already in the library.'
                  : 'Package inspected and saved. Review the scan result below.',
              );
            });
          }}
        >
          <fieldset disabled={pending || !data.canManage}>
            <label htmlFor="attachment-storage">Package storage</label>
            <select name="storage" id="attachment-storage">
              <option value="database">SitePulse storage</option>
              <option value="google_drive" disabled={!drive.connected}>
                My Google Drive{!drive.connected ? ' (connect first)' : ''}
              </option>
            </select>
            <p>
              Storage applies to new packages. Identical ZIPs reuse the existing
              library entry. The workspace quota applies to both storage
              options.
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
            <label htmlFor="attachment-package">ZIP package</label>
            <input
              id="attachment-package"
              name="package"
              type="file"
              accept=".zip,application/zip"
              required
            />
            <button>{pending ? 'Working…' : 'Upload and scan'}</button>
          </fieldset>
        </form>
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
                  : 'SitePulse storage'}{' '}
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
