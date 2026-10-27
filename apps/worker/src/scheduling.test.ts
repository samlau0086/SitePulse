import { expect, it } from 'vitest';
import { nextProbeDelay } from './scheduling';

it.each([60, 300, 3600])(
  'confirms first failure and recovery after 60s at interval %i',
  (interval) => {
    expect(nextProbeDelay(interval, true, 1, false)).toBe(60);
    expect(nextProbeDelay(interval, false, 0, true)).toBe(60);
    expect(nextProbeDelay(interval, false, 0, false)).toBe(interval);
  },
);
it('bounds persistent failure retries by both normal interval and backoff cap', () => {
  expect(
    [1, 2, 3, 4, 5, 100].map((n) => nextProbeDelay(3600, true, n, false)),
  ).toEqual([60, 120, 240, 480, 960, 960]);
  expect(nextProbeDelay(300, true, 100, false)).toBe(300);
  expect(nextProbeDelay(60, true, 100, false)).toBe(60);
});
