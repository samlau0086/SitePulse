'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../lib/api';

export function IncidentAction({
  siteId,
  incidentId,
}: {
  siteId: string;
  incidentId: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  async function acknowledge() {
    setPending(true);
    setError('');
    try {
      await api(`/sites/${siteId}/incidents/${incidentId}/acknowledge`, {});
      router.refresh();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Unable to acknowledge incident.',
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <>
      <button disabled={pending} onClick={acknowledge}>
        Acknowledge
      </button>
      {error && <p role="alert">{error}</p>}
    </>
  );
}
