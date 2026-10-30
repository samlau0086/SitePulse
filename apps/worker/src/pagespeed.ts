import { lookup } from 'node:dns/promises';
import {
  performanceReport,
  type PerformanceReport,
  type PerformanceStrategy,
} from '@sitepulse/api-contracts';
import { publicDestination } from './probe';

export type PageSpeedResult =
  | { report: PerformanceReport; errorCode?: never }
  | { errorCode: string; report?: never };
type Dependencies = {
  fetch: typeof fetch;
  resolve: (host: string) => Promise<string[]>;
};
const defaults: Dependencies = {
  fetch: (...args) => fetch(...args),
  resolve: async (host) =>
    (await lookup(host, { all: true, verbatim: true })).map((r) => r.address),
};
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('INVALID_RESPONSE');
  return value as Record<string, unknown>;
}
function metric(audits: Record<string, unknown>, id: string) {
  const entry = audits[id];
  if (!entry || typeof entry !== 'object') return null;
  const value = (entry as Record<string, unknown>).numericValue;
  return typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1e9
    ? value
    : null;
}
export function parsePageSpeed(
  payload: unknown,
  target: string,
  strategy: PerformanceStrategy,
): PerformanceReport {
  const lighthouse = object(object(payload).lighthouseResult);
  if (lighthouse.runtimeError) throw new Error('ANALYSIS_FAILED');
  if (
    typeof lighthouse.requestedUrl !== 'string' ||
    new URL(lighthouse.requestedUrl).href !== new URL(target).href ||
    object(lighthouse.configSettings).formFactor !== strategy
  )
    throw new Error('INVALID_RESPONSE');
  const score = object(object(lighthouse.categories).performance).score;
  if (
    typeof score !== 'number' ||
    !Number.isFinite(score) ||
    score < 0 ||
    score > 1
  )
    throw new Error('INVALID_RESPONSE');
  const audits = object(lighthouse.audits);
  const opportunities: PerformanceReport['opportunities'] = [];
  for (const [id, raw] of Object.entries(audits)) {
    if (!raw || typeof raw !== 'object') continue;
    const audit = raw as Record<string, unknown>;
    const details = audit.details as Record<string, unknown> | undefined;
    const savings = details?.overallSavingsMs;
    if (
      details?.type !== 'opportunity' ||
      typeof savings !== 'number' ||
      !Number.isFinite(savings) ||
      savings <= 0 ||
      savings > 1e9 ||
      typeof audit.title !== 'string'
    )
      continue;
    const title = audit.title
      .replace(/\p{Cc}/gu, ' ')
      .trim()
      .slice(0, 300);
    if (title)
      opportunities.push({ id: id.slice(0, 100), title, savingsMs: savings });
  }
  return performanceReport.parse({
    score: Math.round(score * 100),
    analyzedAt: lighthouse.fetchTime,
    lighthouseVersion: lighthouse.lighthouseVersion,
    metrics: {
      fcpMs: metric(audits, 'first-contentful-paint'),
      lcpMs: metric(audits, 'largest-contentful-paint'),
      speedIndexMs: metric(audits, 'speed-index'),
      tbtMs: metric(audits, 'total-blocking-time'),
      cls: metric(audits, 'cumulative-layout-shift'),
    },
    opportunities: opportunities
      .sort((a, b) => b.savingsMs - a.savingsMs)
      .slice(0, 5),
  });
}

async function boundedJson(response: Response) {
  if (!response.body) throw new Error('INVALID_RESPONSE');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 4 * 1024 * 1024) throw new Error('RESPONSE_TOO_LARGE');
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } finally {
    await reader.cancel().catch(() => {});
  }
}

export async function fetchPageSpeed(
  target: string,
  strategy: PerformanceStrategy,
  key: string,
  deps: Dependencies = defaults,
): Promise<PageSpeedResult> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      (async (): Promise<PageSpeedResult> => {
        // Resolve only to validate the submitted target. Our only HTTP connection is to Google.
        const destination = await publicDestination(target, deps.resolve);
        if (destination.url.search || destination.url.hash)
          return { errorCode: 'UNSAFE_DESTINATION' };
        if (controller.signal.aborted) return { errorCode: 'TIMEOUT' };
        const endpoint = new URL(
          'https://www.googleapis.com/pagespeedonline/v5/runPagespeed',
        );
        endpoint.searchParams.set('url', target);
        endpoint.searchParams.set('strategy', strategy);
        endpoint.searchParams.set('category', 'performance');
        endpoint.searchParams.set('key', key);
        const response = await deps.fetch(endpoint, {
          redirect: 'error',
          signal: controller.signal,
          headers: { accept: 'application/json' },
        });
        if (!response.ok) {
          await response.body?.cancel();
          return {
            errorCode:
              response.status === 429
                ? 'QUOTA_EXCEEDED'
                : [400, 401, 403].includes(response.status)
                  ? 'PROVIDER_REJECTED'
                  : 'PROVIDER_UNAVAILABLE',
          };
        }
        return {
          report: parsePageSpeed(await boundedJson(response), target, strategy),
        };
      })(),
      new Promise<PageSpeedResult>((resolve) => {
        timer = setTimeout(() => {
          controller.abort();
          resolve({ errorCode: 'TIMEOUT' });
        }, 90000);
      }),
    ]);
  } catch (error) {
    // Never return/log provider bodies, URLs, request errors or API keys.
    const code = error instanceof Error ? error.message : '';
    return {
      errorCode: [
        'UNSAFE_DESTINATION',
        'ANALYSIS_FAILED',
        'RESPONSE_TOO_LARGE',
      ].includes(code)
        ? code
        : 'ANALYSIS_UNAVAILABLE',
    };
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
