import { afterEach, expect, it, vi } from 'vitest';
import { fetchPageSpeed, parsePageSpeed } from './pagespeed';

const target = 'https://example.com/';
function payload(score: unknown = 0.93, formFactor = 'mobile') {
  return {
    lighthouseResult: {
      requestedUrl: target,
      configSettings: { formFactor },
      fetchTime: '2026-10-30T00:00:00.000Z',
      lighthouseVersion: '13.0.0',
      categories: { performance: { score } },
      audits: {
        'largest-contentful-paint': { numericValue: 2200 },
        'total-blocking-time': { numericValue: -1 },
        opportunity: {
          title: 'Reduce scripts',
          details: { type: 'opportunity', overallSavingsMs: 123 },
        },
      },
    },
  };
}
afterEach(() => vi.useRealTimers());
it('keeps zero distinct from unavailable, validates device and bounds metrics', () => {
  const report = parsePageSpeed(payload(0), target, 'mobile');
  expect(report.score).toBe(0);
  expect(report.metrics.lcpMs).toBe(2200);
  expect(report.metrics.tbtMs).toBeNull();
  expect(report.metrics.cls).toBeNull();
  expect(report.opportunities[0]?.savingsMs).toBe(123);
  expect(parsePageSpeed(payload(1, 'desktop'), target, 'desktop').score).toBe(
    100,
  );
  for (const score of [null, -1, 1.1, NaN])
    expect(() => parsePageSpeed(payload(score), target, 'mobile')).toThrow();
  expect(() => parsePageSpeed(payload(), target, 'desktop')).toThrow();
  expect(() =>
    parsePageSpeed(payload(), 'https://other.example/', 'mobile'),
  ).toThrow();
  expect(() =>
    parsePageSpeed(
      { lighthouseResult: { runtimeError: {} } },
      target,
      'mobile',
    ),
  ).toThrow('ANALYSIS_FAILED');
});
it('uses only the fixed Google endpoint with redirects disabled', async () => {
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValue(Response.json(payload()));
  const result = await fetchPageSpeed(target, 'mobile', 'fixture-key', {
    fetch: request,
    resolve: async () => ['8.8.8.8'],
  });
  expect(result.report?.score).toBe(93);
  const [url, options] = request.mock.calls[0]!;
  expect(new URL(String(url)).origin).toBe('https://www.googleapis.com');
  expect(new URL(String(url)).searchParams.get('url')).toBe(target);
  expect(options?.redirect).toBe('error');
});
it('rejects private/mixed DNS, credentials, ports and query strings before Google calls', async () => {
  const request = vi.fn<typeof fetch>();
  for (const [url, addresses] of [
    [target, ['127.0.0.1']],
    [target, ['8.8.8.8', '10.0.0.1']],
    ['https://user:pass@example.com/', ['8.8.8.8']],
    ['https://example.com:8443/', ['8.8.8.8']],
    ['https://example.com/?token=private', ['8.8.8.8']],
  ] as const) {
    expect(
      (
        await fetchPageSpeed(url, 'mobile', 'fixture-key', {
          fetch: request,
          resolve: async () => [...addresses],
        })
      ).errorCode,
    ).toBe('UNSAFE_DESTINATION');
  }
  expect(request).not.toHaveBeenCalled();
});
it('sanitizes provider failures and limits response size', async () => {
  for (const [status, code] of [
    [429, 'QUOTA_EXCEEDED'],
    [403, 'PROVIDER_REJECTED'],
    [503, 'PROVIDER_UNAVAILABLE'],
  ] as const) {
    expect(
      await fetchPageSpeed(target, 'mobile', 'secret', {
        resolve: async () => ['8.8.8.8'],
        fetch: vi
          .fn()
          .mockResolvedValue(new Response('secret body', { status })),
      }),
    ).toEqual({ errorCode: code });
  }
  expect(
    await fetchPageSpeed(target, 'mobile', 'secret', {
      resolve: async () => ['8.8.8.8'],
      fetch: vi.fn().mockRejectedValue(new Error('secret')),
    }),
  ).toEqual({ errorCode: 'ANALYSIS_UNAVAILABLE' });
  expect(
    await fetchPageSpeed(target, 'mobile', 'secret', {
      resolve: async () => ['8.8.8.8'],
      fetch: vi
        .fn()
        .mockResolvedValue(new Response('x'.repeat(4 * 1024 * 1024 + 1))),
    }),
  ).toEqual({ errorCode: 'RESPONSE_TOO_LARGE' });
});
it('bounds DNS hangs with the overall timeout', async () => {
  vi.useFakeTimers();
  const request = vi.fn<typeof fetch>();
  const result = fetchPageSpeed(target, 'mobile', 'secret', {
    fetch: request,
    resolve: () => new Promise(() => {}),
  });
  await vi.advanceTimersByTimeAsync(90000);
  expect(await result).toEqual({ errorCode: 'TIMEOUT' });
  expect(request).not.toHaveBeenCalled();
});
