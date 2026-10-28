export function formatTimestamp(value: string | null, timeZone = 'UTC') {
  if (!value) return 'Not received';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not received';
  return `${new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
    timeZoneName: 'shortOffset',
  }).format(date)} (${timeZone})`;
}
