'use client';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';

export function NotificationVerification() {
  const [credentials, setCredentials] = useState({ endpointId: '', token: '' });
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.slice(1));
    setCredentials({
      endpointId: hash.get('endpointId') ?? '',
      token: hash.get('token') ?? '',
    });
    window.history.replaceState(null, '', window.location.pathname);
  }, []);
  async function confirm() {
    setPending(true);
    setError('');
    try {
      await api('/notification-endpoints/verify', credentials);
      setDone(true);
      setCredentials({ endpointId: '', token: '' });
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Unable to verify recipient.',
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <>
      {done ? (
        <p role="status">
          Recipient verified. You may close this page. The workspace
          administrator controls whether delivery is enabled.
        </p>
      ) : (
        <>
          <p>
            Confirm that this recipient may receive SitePulse workspace incident
            and recovery notifications. This does not create an account or grant
            workspace access.
          </p>
          <button
            disabled={pending || !credentials.token || !credentials.endpointId}
            onClick={() => void confirm()}
          >
            Confirm alert recipient
          </button>
          {!credentials.token && (
            <p>
              Open the full link from the verification email or Bark push. If
              you refreshed this page, reopen the notification link.
            </p>
          )}
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </>
  );
}
