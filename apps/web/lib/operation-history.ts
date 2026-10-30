import type { SoftwareOperation } from '@sitepulse/api-contracts';

export type OperationPeriod = 'all' | 'today' | 'yesterday' | 'range';

export function calendarDate(value: string | number, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(value));
  const part = (name: string) =>
    parts.find((item) => item.type === name)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function filterOperationHistory(
  operations: SoftwareOperation[],
  status: SoftwareOperation['status'] | 'all',
  period: OperationPeriod,
  start: string,
  end: string,
  timeZone: string,
  now = Date.now(),
) {
  const today = calendarDate(now, timeZone);
  // Subtract a calendar day, not 24 hours in a zone with daylight saving.
  const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000)
    .toISOString()
    .slice(0, 10);
  return operations
    .filter((op) => {
      if (status !== 'all' && op.status !== status) return false;
      if (period === 'all') return true;
      const date = calendarDate(op.createdAt, timeZone);
      if (period === 'today') return date === today;
      if (period === 'yesterday') return date === yesterday;
      return (!start || date >= start) && (!end || date <= end);
    })
    .sort(
      (a, b) =>
        Date.parse(b.createdAt) - Date.parse(a.createdAt) ||
        a.id.localeCompare(b.id),
    );
}
