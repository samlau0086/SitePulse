'use client';

import { createContext, useContext, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import type { UserPreferences } from '@sitepulse/api-contracts';
import { api } from '../lib/api';
import { formatTimestamp } from '../lib/time';

const TimeZoneContext = createContext('UTC');
export function TimeZoneProvider({
  timeZone,
  children,
}: {
  timeZone: string;
  children: React.ReactNode;
}) {
  return <TimeZoneContext value={timeZone}>{children}</TimeZoneContext>;
}
export function useTimeZone() {
  return useContext(TimeZoneContext);
}
export function Timestamp({ value }: { value: string | null | undefined }) {
  const timeZone = useTimeZone();
  if (!value || Number.isNaN(Date.parse(value))) return <>Not received</>;
  return (
    <time dateTime={value} title={`UTC: ${new Date(value).toISOString()}`}>
      {formatTimestamp(value, timeZone)}
    </time>
  );
}

export function UserPreferencesForm({
  timeZone,
  availableTimeZones,
}: UserPreferences & { availableTimeZones: string[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState(timeZone);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const zones = [...new Set(['UTC', selected, ...availableTimeZones])].sort();
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError('');
    setMessage('');
    try {
      await api('/users/me/preferences', { timeZone: selected }, 'PATCH');
      setMessage(`Time zone saved: ${selected}.`);
      router.refresh();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Unable to save time zone.',
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <form className="card creation-form" onSubmit={save}>
      <h2>Time zone</h2>
      <p>
        Applies to your account across all workspaces and devices. Monitoring
        schedules and stored timestamps remain in UTC. Daylight saving is
        applied automatically.
      </p>
      <fieldset disabled={pending}>
        <label htmlFor="user-time-zone">Display time zone</label>
        <select
          id="user-time-zone"
          value={selected}
          onChange={(event) => {
            setSelected(event.target.value);
            setMessage('');
          }}
        >
          {zones.map((zone) => (
            <option key={zone} value={zone}>
              {zone.replaceAll('_', ' ')}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="secondary"
          onClick={() => {
            setSelected(Intl.DateTimeFormat().resolvedOptions().timeZone);
            setMessage('');
          }}
        >
          Use browser time zone
        </button>
        <p className="muted">
          Choose a region/city, then save to apply it. Times include the zone
          and UTC offset.
        </p>
        <button type="submit">{pending ? 'Saving…' : 'Save time zone'}</button>
      </fieldset>
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
    </form>
  );
}
