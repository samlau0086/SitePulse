'use client';
import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { Site } from '@sitepulse/api-contracts';
import { api } from '../lib/api';

export function SitesPanel({
  organizationId,
  sites,
  canManage,
}: {
  organizationId: string;
  sites: Site[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError('');
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      await api(`/organizations/${organizationId}/sites`, {
        name: data.get('name'),
        canonicalUrl: data.get('canonicalUrl'),
      });
      form.reset();
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to add site.');
    } finally {
      setPending(false);
    }
  }
  return (
    <section className="card">
      <h2>Sites</h2>
      <p>
        Heartbeats run every 15 minutes. After 45 minutes without a heartbeat,
        the connection becomes stale. Reload to see the latest state.
      </p>
      <ul>
        {sites.map((site) => (
          <li key={site.id}>
            <Link href={`/app/sites/${site.id}`}>{site.name}</Link> —{' '}
            {site.status === 'degraded' ? 'Stale heartbeat' : site.status}
          </li>
        ))}
      </ul>
      {!sites.length && <p>No sites yet.</p>}
      {canManage && (
        <form onSubmit={create}>
          <h2>Add a WordPress site</h2>
          <label htmlFor="site-name">Name</label>
          <input id="site-name" name="name" required maxLength={100} />
          <label htmlFor="site-url">Public site URL</label>
          <input
            id="site-url"
            name="canonicalUrl"
            type="url"
            required
            maxLength={2048}
          />
          <button disabled={pending}>Add site</button>
        </form>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
export function SiteControls({ siteId }: { siteId: string }) {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState(false);
  async function action(operation: string) {
    setPending(true);
    setCode('');
    setMessage('');
    try {
      const result = await api<{ challenge?: string; expiresAt?: string }>(
        `/sites/${siteId}/${operation}`,
        {},
      );
      if (result.challenge) {
        setCode(result.challenge);
        setMessage(
          `Expires ${new Date(result.expiresAt!).toLocaleString()}. Paste into WordPress Settings → SitePulse. Treat this code as a secret.`,
        );
      } else
        setMessage('Site disconnected. The previous credential is revoked.');
      router.refresh();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'Request failed.');
    } finally {
      setPending(false);
    }
  }
  return (
    <section className="card">
      <h2>Connect WordPress</h2>
      <p>
        Install plugins/sitepulse-connector on your WordPress site. A pairing
        code expires after 10 minutes and can be used once. Rotation immediately
        revokes the existing credential and requires pairing again.
      </p>
      <button disabled={pending} onClick={() => action('pairing-challenges')}>
        Create pairing code
      </button>{' '}
      <button disabled={pending} onClick={() => action('rotate-credential')}>
        Revoke and re-pair
      </button>{' '}
      <button disabled={pending} onClick={() => action('disconnect')}>
        Disconnect
      </button>
      {message && <p role="status">{message}</p>}
      {code && (
        <>
          <label htmlFor="pairing-code">Single-use pairing code</label>
          <input
            id="pairing-code"
            readOnly
            value={code}
            autoComplete="off"
            onFocus={(event) => event.target.select()}
          />
        </>
      )}
    </section>
  );
}
