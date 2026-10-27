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
  const [chatChannel, setChatChannel] = useState<'slack' | 'telegram'>('slack');
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
          ? 'Test notification accepted by the transport. Check the selected recipient or channel.'
          : path.endsWith('/resend') || method === 'POST'
            ? 'Verification notification sent. Open it and confirm; no login is required.'
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
  async function addBark(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const input = {
      label: values.get('label'),
      deviceKey: values.get('deviceKey'),
    };
    form.reset();
    await run(`${base}/notification-endpoints/bark`, input);
  }
  async function addChat(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const input =
      chatChannel === 'slack'
        ? { label: values.get('label'), webhookUrl: values.get('webhookUrl') }
        : {
            label: values.get('label'),
            botToken: values.get('botToken'),
            chatId: values.get('chatId'),
          };
    form.reset();
    await run(`${base}/notification-endpoints/${chatChannel}`, input);
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
          Automatically email currently verified members:{' '}
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
      <form className="creation-form" onSubmit={addBark}>
        <fieldset disabled={pending || !data.canManage}>
          <legend>Add a Bark device</legend>
          <label htmlFor="bark-label">Device or recipient name</label>
          <input
            id="bark-label"
            name="label"
            required
            maxLength={80}
            autoComplete="off"
          />
          <label htmlFor="bark-key">Bark device Key</label>
          <input
            id="bark-key"
            name="deviceKey"
            type="password"
            required
            minLength={8}
            maxLength={256}
            autoComplete="new-password"
            spellCheck={false}
          />
          <p className="muted">
            Enter only the Key from the official Bark app, not its full URL.
            Keys are encrypted and never shown again. Tap the verification push
            and confirm before this device receives alerts. Self-hosted servers
            are not supported in this release.
          </p>
          <button>Add Bark and send verification</button>
        </fieldset>
      </form>
      <form className="creation-form" onSubmit={addChat}>
        <fieldset disabled={pending || !data.canManage}>
          <legend>Add a Slack or Telegram recipient</legend>
          <label htmlFor="chat-channel">Channel</label>
          <select
            id="chat-channel"
            value={chatChannel}
            onChange={(event) =>
              setChatChannel(event.target.value as 'slack' | 'telegram')
            }
          >
            <option value="slack">Slack</option>
            <option value="telegram">Telegram</option>
          </select>
          <label htmlFor="chat-label">Recipient or channel name</label>
          <input
            id="chat-label"
            name="label"
            required
            maxLength={80}
            autoComplete="off"
          />
          {chatChannel === 'slack' ? (
            <>
              <label htmlFor="slack-webhook">Slack Incoming Webhook URL</label>
              <input
                id="slack-webhook"
                name="webhookUrl"
                type="password"
                required
                maxLength={512}
                autoComplete="new-password"
                spellCheck={false}
              />
              <p className="muted">
                Use an Incoming Webhook from hooks.slack.com for the destination
                channel. Add a separate recipient for each webhook.
              </p>
            </>
          ) : (
            <>
              <label htmlFor="telegram-token">Telegram Bot Token</label>
              <input
                id="telegram-token"
                name="botToken"
                type="password"
                required
                maxLength={121}
                autoComplete="new-password"
                spellCheck={false}
              />
              <label htmlFor="telegram-chat">Telegram Chat ID</label>
              <input
                id="telegram-chat"
                name="chatId"
                required
                maxLength={21}
                autoComplete="off"
                spellCheck={false}
              />
              <p className="muted">
                Start the bot in your private chat, or add it to a group with
                permission to send messages. Use the numeric Chat ID, including
                the minus sign for groups.
              </p>
            </>
          )}
          <p className="muted">
            Credentials are encrypted and hidden after saving. Open the
            verification message in the destination and explicitly confirm
            before alerts are enabled. Add multiple destinations separately.
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
          <h3 className="recipient-address">
            {row.type === 'email' ? row.destination : row.label}
          </h3>
          <p className="muted">
            {row.type === 'email'
              ? 'Email'
              : row.type === 'bark'
                ? 'Bark · device Key hidden'
                : `${row.type === 'slack' ? 'Slack' : 'Telegram'} · credentials hidden`}
          </p>
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
              {row.type === 'email'
                ? 'Send test email'
                : row.type === 'bark'
                  ? 'Send test push'
                  : 'Send test message'}
            </button>
            <button
              className="secondary danger"
              disabled={pending || !data.canManage}
              onClick={() => {
                if (
                  window.confirm(
                    `Delete recipient ${row.label ?? row.destination}? Pending alerts will be suppressed; notifications already handed off cannot be recalled.`,
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
        Verification and test notifications share a 60-second recipient cooldown
        and a 10-per-hour workspace limit. Disabling recipients suppresses
        pending alerts; messages already in flight or accepted by the provider
        cannot be recalled. All channels share the 20 managed-recipient limit.
        All channels receive the same confirmed incidents and recovery events;
        delivery timing depends on the provider, network and device settings.
      </p>
    </section>
  );
}
