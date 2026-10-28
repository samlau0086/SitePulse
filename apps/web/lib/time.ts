export function formatTimestamp(value: string | null, timeZone = 'UTC') {
  if (!value) return 'Not received';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not received';
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
    timeZoneName: 'shortOffset',
  }).formatToParts(date);
  // ICU versions differ in how shortOffset labels a zero UTC offset.
  const formatted = parts
    .map((part) =>
      part.type === 'timeZoneName' && /^GMT[+-]0(?::00)?$/.test(part.value)
        ? 'GMT'
        : part.value,
    )
    .join('');
  return `${formatted} (${timeZone})`;
}
