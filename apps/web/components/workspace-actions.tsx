'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import * as Label from '@radix-ui/react-label';
import { api } from '../lib/api';

export function LogoutButton() {
  const router = useRouter();
  const [error, setError] = useState('');
  return (
    <>
      <button
        onClick={async () => {
          try {
            await api('/auth/logout', {});
            router.replace('/login');
            router.refresh();
          } catch {
            setError('Unable to log out. Please try again.');
          }
        }}
      >
        Log out
      </button>
      {error && <p role="alert">{error}</p>}
    </>
  );
}
export function CreateOrganizationForm() {
  const router = useRouter();
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError('');
    const form = new FormData(event.currentTarget);
    try {
      await api('/organizations', {
        name: form.get('name'),
        slug: form.get('slug'),
      });
      (event.target as HTMLFormElement).reset();
      router.refresh();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Unable to create organization.',
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <form className="creation-form" onSubmit={submit}>
      <h2>Create an organization</h2>
      <Label.Root htmlFor="org-name">Organization name</Label.Root>
      <input id="org-name" name="name" required maxLength={100} />
      <Label.Root htmlFor="org-slug">Workspace slug</Label.Root>
      <input
        id="org-slug"
        name="slug"
        required
        minLength={3}
        maxLength={63}
        pattern="[a-z0-9]+(-[a-z0-9]+)*"
        aria-describedby="slug-help"
      />
      <p id="slug-help" className="muted">
        3–63 lowercase letters, numbers, or separating hyphens.
      </p>
      {error && <p role="alert">{error}</p>}
      <button disabled={pending}>
        {pending ? 'Creating…' : 'Create organization'}
      </button>
    </form>
  );
}
