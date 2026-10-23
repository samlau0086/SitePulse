'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import * as Label from '@radix-ui/react-label';
import { api } from '../lib/api';

export function AuthForm({ mode }: { mode: 'register' | 'login' }) {
  const router = useRouter();
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError('');
    const form = new FormData(event.currentTarget);
    try {
      await api(`/auth/${mode}`, {
        email: form.get('email'),
        password: form.get('password'),
        ...(mode === 'register' ? { name: form.get('name') } : {}),
      });
      router.replace(mode === 'register' ? '/verify-email' : '/app');
      router.refresh();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Unable to authenticate.',
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <form
      onSubmit={submit}
      aria-label={mode === 'register' ? 'Create account' : 'Log in'}
    >
      {mode === 'register' && (
        <>
          <Label.Root htmlFor="name">Name</Label.Root>
          <input
            id="name"
            name="name"
            autoComplete="name"
            required
            maxLength={100}
          />
        </>
      )}
      <Label.Root htmlFor="email">Email</Label.Root>
      <input
        id="email"
        name="email"
        type="email"
        autoComplete="email"
        required
        maxLength={254}
      />
      <Label.Root htmlFor="password">Password</Label.Root>
      <input
        id="password"
        name="password"
        type="password"
        autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
        required
        minLength={mode === 'register' ? 12 : 1}
        maxLength={128}
        aria-describedby={mode === 'register' ? 'password-help' : undefined}
      />
      {mode === 'register' && (
        <p id="password-help" className="muted">
          Use at least 12 characters. A long, unique passphrase works well.
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      <button disabled={pending}>
        {pending
          ? 'Please wait…'
          : mode === 'register'
            ? 'Create account'
            : 'Log in'}
      </button>
    </form>
  );
}
