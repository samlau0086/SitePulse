'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { api } from '../lib/api';

export function AuthRecoveryForm({
  mode,
}: {
  mode: 'forgot' | 'reset' | 'verify';
}) {
  const [token, setToken] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  useEffect(() => {
    const value = new URLSearchParams(window.location.hash.slice(1)).get(
      'token',
    );
    if (value) {
      setToken(value);
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError('');
    setMessage('');
    const form = new FormData(event.currentTarget);
    try {
      const path =
        mode === 'forgot'
          ? '/auth/password/forgot'
          : mode === 'reset'
            ? '/auth/password/reset'
            : token
              ? '/auth/email/verify'
              : '/auth/email/resend';
      await api(
        path,
        mode === 'forgot' || (mode === 'verify' && !token)
          ? { email: form.get('email') }
          : mode === 'reset'
            ? { token, newPassword: form.get('password') }
            : { token },
      );
      setMessage(
        mode === 'reset'
          ? 'Password updated. Please log in again.'
          : mode === 'verify' && token
            ? 'Email verified. You can continue to your workspace.'
            : 'If this address is eligible, an email will arrive shortly.',
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Request failed.');
    } finally {
      setPending(false);
    }
  }
  return (
    <form onSubmit={submit} aria-label="Account recovery and verification">
      {(mode === 'forgot' || (mode === 'verify' && !token)) && (
        <>
          <label htmlFor="email">Email</label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            maxLength={254}
          />
        </>
      )}
      {mode === 'reset' && (
        <>
          <label htmlFor="password">New password</label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={12}
            maxLength={128}
          />
          {!token && <p>Open the link from your reset email first.</p>}
        </>
      )}
      {mode === 'verify' && token && (
        <p>Confirm to verify the email address that received this link.</p>
      )}
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      <button disabled={pending || (mode === 'reset' && !token)}>
        {pending
          ? 'Please wait…'
          : mode === 'reset'
            ? 'Reset password'
            : mode === 'verify' && token
              ? 'Verify email'
              : 'Send email'}
      </button>
      <p>
        <Link href="/login">Log in</Link> · <Link href="/app">Workspace</Link>
      </p>
    </form>
  );
}
