'use client';
import { useEffect, useState, type FormEvent } from 'react';
import type { NotificationConfiguration } from '@sitepulse/api-contracts';
import { api } from '../lib/api';

export function NotificationSettings({
  organizationId,
  initial,
}: {
  organizationId: string;
  initial: NotificationConfiguration;
}) {
  const [data, setData] = useState(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  useEffect(() => {
    setData(initial);
  }, [initial]);
  const base = `/organizations/${organizationId}`;
  async function run(path: string, body: unknown, method = 'POST') {
    setPending(true);
    setError('');
    setMessage('');
    try {
      await api(path, body, method);
      setMessage(
        path.endsWith('/test')
          ? 'Test email accepted by the mail transport. Check the recipient inbox.'
          : path.endsWith('/resend') || method === 'POST'
            ? 'Verification email sent. Open it and confirm; no login is required.'
            : 'Notification settings saved.',
      );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Unable to save settings.',
      );
    } finally {
      try {
        setData(
          await api<NotificationConfiguration>(
            `${base}/notification-endpoints`,
            undefined,
            'GET',
          ),
        );
      } catch {
        setError(
          'Unable to refresh settings. Refresh the page before trying again.',
        );
      }
      setPending(false);
    }
  }
  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const destination = new FormData(form).get('destination');
    await run(`${base}/notification-endpoints`, { destination });
  }
  return (
    <section aria-label="Notification recipients">
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      {!data.canManage && (
        <p className="notice-warning">
          Only verified workspace owners and administrators can change
          notification settings.
        </p>
      )}
      <div className="card">
        <h2>Workspace members</h2>
        <p>
          Automatically notify currently verified members:{' '}
          <strong>{data.includeMembers ? 'On' : 'Off'}</strong>
        </p>
        <p className="muted">
          {data.memberEmails.length
            ? data.memberEmails.join(', ')
            : 'No verified members.'}
        </p>
        <button
          className="secondary"
          disabled={pending || !data.canManage}
          onClick={() =>
            void run(
              `${base}/notification-settings`,
              { includeMembers: !data.includeMembers },
              'PATCH',
            )
          }
        >
          {data.includeMembers
            ? 'Turn off member notifications'
            : 'Turn on member notifications'}
        </button>
      </div>
      <form className="creation-form" onSubmit={add}>
        <fieldset disabled={pending || !data.canManage}>
          <legend>Add an email recipient</legend>
          <label htmlFor="recipient-email">Email address</label>
          <input
            id="recipient-email"
            name="destination"
            type="email"
            required
            maxLength={254}
            autoComplete="off"
          />
          <p className="muted">
            Up to 20 recipients. A one-hour verification link is emailed
            immediately. New recipients receive future events only.
          </p>
          <button>Add and send verification</button>
        </fieldset>
      </form>
      <h2>Managed recipients ({data.endpoints.length}/20)</h2>
      <p className="muted">
        Managed addresses override automatic member delivery, including while
        pending or disabled. Deleted addresses do not silently return to member
        delivery; add and verify again to restore them. The same address
        receives only one email per event.
      </p>
      {!data.endpoints.length && <p>No managed recipients yet.</p>}
      {data.endpoints.map((row) => (
        <article className="card" key={row.id}>
          <h3 className="recipient-address">{row.destination}</h3>
          <p>
            {row.verifiedAt ? 'Verified' : 'Pending verification'} ·{' '}
            {row.enabled ? 'Enabled' : 'Disabled'}
          </p>
          <div className="notification-actions">
            <button
              className="secondary"
              disabled={pending || !data.canManage}
              onClick={() =>
                void run(
                  `${base}/notification-endpoints/${row.id}`,
                  { enabled: !row.enabled },
                  'PATCH',
                )
              }
            >
              {row.enabled ? 'Disable' : 'Enable'}
            </button>
            {!row.verifiedAt && (
              <button
                className="secondary"
                disabled={pending || !data.canManage}
                onClick={() =>
                  void run(
                    `${base}/notification-endpoints/${row.id}/resend`,
                    {},
                  )
                }
              >
                Resend verification
              </button>
            )}
            <button
              className="secondary"
              disabled={
                pending || !data.canManage || !row.verifiedAt || !row.enabled
              }
              onClick={() =>
                void run(`${base}/notification-endpoints/${row.id}/test`, {})
              }
            >
              Send test email
            </button>
            <button
              className="secondary danger"
              disabled={pending || !data.canManage}
              onClick={() => {
                if (
                  window.confirm(
                    `Delete recipient ${row.destination}? Pending alerts will be suppressed; emails already handed off cannot be recalled.`,
                  )
                )
                  void run(
                    `${base}/notification-endpoints/${row.id}`,
                    {},
                    'DELETE',
                  );
              }}
            >
              Delete
            </button>
          </div>
        </article>
      ))}
      <p className="muted">
        Verification and test emails share a 60-second recipient cooldown and a
        10-per-hour workspace limit. Disabling recipients suppresses pending
        alerts; messages already in flight or accepted by the provider cannot be
        recalled.
      </p>
    </section>
  );
}
