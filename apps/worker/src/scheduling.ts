// Confirmation and recovery do not wait for the normal probe interval.
export function nextProbeDelay(
  interval: number,
  bad: boolean,
  failures: number,
  recovering: boolean,
) {
  return bad
    ? Math.min(interval, 60 * 2 ** Math.min(Math.max(failures - 1, 0), 4))
    : recovering
      ? 60
      : interval;
}
