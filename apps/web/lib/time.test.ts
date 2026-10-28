import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { formatTimestamp } from './time';
import { Timestamp, TimeZoneProvider } from '../components/user-preferences';

it('converts instants across date boundaries and supports fractional offsets', () => {
  const instant = '2026-10-28T23:30:45Z';
  expect(formatTimestamp(instant, 'Asia/Shanghai')).toBe(
    '29 Oct 2026, 07:30:45 GMT+8 (Asia/Shanghai)',
  );
  expect(formatTimestamp(instant, 'Asia/Kathmandu')).toBe(
    '29 Oct 2026, 05:15:45 GMT+5:45 (Asia/Kathmandu)',
  );
  expect(formatTimestamp(instant)).toBe('28 Oct 2026, 23:30:45 GMT (UTC)');
});

it('uses the instant-specific daylight-saving offset, including repeated local hours', () => {
  expect(formatTimestamp('2026-11-01T05:30:00Z', 'America/New_York')).toBe(
    '01 Nov 2026, 01:30:00 GMT-4 (America/New_York)',
  );
  expect(formatTimestamp('2026-11-01T06:30:00Z', 'America/New_York')).toBe(
    '01 Nov 2026, 01:30:00 GMT-5 (America/New_York)',
  );
  expect(formatTimestamp('2026-03-08T06:59:59Z', 'America/New_York')).toContain(
    '01:59:59 GMT-5',
  );
  expect(formatTimestamp('2026-03-08T07:00:00Z', 'America/New_York')).toContain(
    '03:00:00 GMT-4',
  );
});

it('keeps missing/invalid timestamps readable and preserves UTC evidence in markup', () => {
  expect(formatTimestamp(null)).toBe('Not received');
  expect(formatTimestamp('invalid')).toBe('Not received');
  const value = '2026-10-28T00:00:00Z';
  const html = renderToStaticMarkup(
    createElement(TimeZoneProvider, {
      timeZone: 'Asia/Shanghai',
      children: createElement(Timestamp, { value }),
    }),
  );
  expect(html).toContain('08:00:00 GMT+8 (Asia/Shanghai)');
  expect(html).toContain(`dateTime="${value}"`);
  expect(html).toContain('UTC: 2026-10-28T00:00:00.000Z');
});
