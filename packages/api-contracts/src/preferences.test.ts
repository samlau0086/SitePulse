import { expect, it } from 'vitest';
import { userPreferences } from './index';

it.each([
  'UTC',
  'Asia/Shanghai',
  'Asia/Kathmandu',
  'America/New_York',
  'Europe/Berlin',
  'Pacific/Auckland',
])('accepts supported named zone %s', (timeZone) => {
  expect(userPreferences.parse({ timeZone })).toEqual({ timeZone });
});
it.each(['', 'Mars/Olympus', '+08:00', '-0500', 'UTC+8', 'A'.repeat(101)])(
  'rejects invalid zone %s',
  (timeZone) => {
    expect(userPreferences.safeParse({ timeZone }).success).toBe(false);
  },
);
it('rejects caller-supplied identities and unrelated preferences', () => {
  expect(
    userPreferences.safeParse({ timeZone: 'UTC', userId: 'other-user' })
      .success,
  ).toBe(false);
  expect(
    userPreferences.safeParse({ timeZone: 'UTC', plan: 'agency' }).success,
  ).toBe(false);
});
