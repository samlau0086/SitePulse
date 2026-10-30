'use client';
import { useEffect, useRef, useState } from 'react';
import type {
  SitePerformance,
  PerformanceDevice,
} from '@sitepulse/api-contracts';
import { api } from '../lib/api';
import { Timestamp } from './user-preferences';
import { Icon } from './icon';

const labels: Record<PerformanceDevice['state'], string> = {
  pending: 'Not checked',
  queued: 'Queued — awaiting worker / available quota',
  running: 'Analysis running',
  ready: 'Current result',
  stale: 'Result out of date',
  error: 'Latest attempt failed',
};
const errors: Record<string, string> = {
  QUOTA_EXCEEDED: 'Google request quota exceeded.',
  PROVIDER_REJECTED:
    'Google rejected the request. The platform administrator should check the API key and enabled API.',
  PROVIDER_UNAVAILABLE: 'Google is temporarily unavailable.',
  UNSAFE_DESTINATION:
    'The registered URL must resolve exclusively to public addresses.',
  TIMEOUT: 'Analysis timed out.',
  RESPONSE_TOO_LARGE: 'The Google response exceeded the size limit.',
  ANALYSIS_FAILED: 'Google could not analyze this page.',
  INTERRUPTED: 'The worker attempt was interrupted or discarded.',
};
export function PerformanceScore({ device }: { device: PerformanceDevice }) {
  const score = device.report?.score;
  return (
    <span
      className={`status-badge ${score === undefined ? '' : score >= 90 ? 'status-healthy' : score >= 50 ? 'status-warning' : 'status-critical'}`}
    >
      <Icon
        name={score === undefined ? 'clock' : score >= 90 ? 'check' : 'alert'}
      />
      {score === undefined
        ? 'No score'
        : `${score}/100 · ${score >= 90 ? 'Good' : score >= 50 ? 'Needs improvement' : 'Poor'}`}
    </span>
  );
}
export function PerformancePanel({
  siteId,
  initial,
  canManage,
}: {
  siteId: string;
  initial: SitePerformance;
  canManage: boolean;
}) {
  const [data, setData] = useState(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [page, setPage] = useState(0);
  const generation = useRef(0);
  const active = data.devices.some(
    (d) => d.state === 'queued' || d.state === 'running',
  );
  useEffect(() => {
    if (!data.enabled || !data.available || pending) return;
    const timer = setInterval(
      async () => {
        const current = ++generation.current;
        try {
          const result = await api<{ performance: SitePerformance }>(
            `/sites/${siteId}/performance`,
            undefined,
            'GET',
          );
          if (current === generation.current) {
            setData(result.performance);
            setError('');
          }
        } catch {
          if (current === generation.current)
            setError(
              'Unable to reload performance results. Displaying previously loaded data.',
            );
        }
      },
      active ? 10000 : 60000,
    );
    return () => {
      clearInterval(timer);
      generation.current++;
    };
  }, [siteId, data.enabled, data.available, active, pending]);
  async function refresh() {
    setPending(true);
    setError('');
    setMessage('');
    generation.current++;
    try {
      await api(`/sites/${siteId}/performance/refresh`, {});
      setMessage(
        'Both device checks are queued. Results appear when the worker completes them.',
      );
      const result = await api<{ performance: SitePerformance }>(
        `/sites/${siteId}/performance`,
        undefined,
        'GET',
      );
      setData(result.performance);
      setPage(0);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Unable to queue checks.',
      );
    } finally {
      setPending(false);
    }
  }
  const currentPage = Math.min(
    page,
    Math.max(0, Math.ceil(data.history.length / 5) - 1),
  );
  return (
    <>
      <section className="card monitoring-panel">
        <h2>
          <Icon name="pulse" /> Page performance
        </h2>
        <p>
          Google PageSpeed Insights / Lighthouse tests the registered site entry
          page on simulated mobile and desktop devices. These are lab results,
          not real-user Core Web Vitals or HTTP response time.
        </p>
        <p className="data-note">
          Daily checks · Manual refresh every 15 minutes · Up to 30 days of
          history. Site Kit and customer Google accounts are not required. The
          page URL is sent to Google for analysis.
        </p>
        {!data.enabled && (
          <p role="status">
            Performance monitoring is disabled. The platform administrator must
            configure the Google API key and enable it.
          </p>
        )}
        {!data.available && (
          <p>Connect this site to start performance checks.</p>
        )}
        <button
          disabled={pending || !canManage || !data.canRefresh}
          onClick={refresh}
        >
          <Icon name="refresh" />{' '}
          {pending ? 'Queueing…' : 'Refresh both devices'}
        </button>
        {!canManage && (
          <p className="data-note">
            A verified workspace owner or administrator can request checks.
          </p>
        )}
        {data.refreshAfter && (
          <p className="data-note">
            Manual refresh available after:{' '}
            <Timestamp value={data.refreshAfter} />
          </p>
        )}
        {active && data.enabled && (
          <p role="status">
            Checks are queued or running. Results reload automatically; the
            shared daily request budget may delay queued work.
          </p>
        )}
        {message && <p role="status">{message}</p>}
        {error && <p role="alert">{error}</p>}
        <div className="monitor-status-grid">
          {data.devices.map((device) => (
            <article className="monitor-status-card" key={device.strategy}>
              <h3>{device.strategy === 'mobile' ? 'Mobile' : 'Desktop'}</h3>
              <PerformanceScore device={device} />
              <p>{labels[device.state]}</p>
              {device.errorCode && (
                <p>
                  {errors[device.errorCode] ??
                    'Performance analysis is unavailable. Retry after the cooldown or the next daily check.'}{' '}
                  Displayed scores are from the last successful result.
                </p>
              )}
              <p>
                Last attempt: <Timestamp value={device.lastAttemptAt} />
              </p>
              {device.report && (
                <>
                  <p>
                    Last successful analysis:{' '}
                    <Timestamp value={device.report.analyzedAt} />
                  </p>
                  <p className="data-note">
                    Lighthouse {device.report.lighthouseVersion}. Scores can
                    vary between runs.
                  </p>
                  <dl className="performance-metrics">
                    {(
                      [
                        [
                          'First contentful paint',
                          device.report.metrics.fcpMs,
                          'ms',
                        ],
                        [
                          'Largest contentful paint',
                          device.report.metrics.lcpMs,
                          'ms',
                        ],
                        [
                          'Speed Index',
                          device.report.metrics.speedIndexMs,
                          'ms',
                        ],
                        [
                          'Total blocking time',
                          device.report.metrics.tbtMs,
                          'ms',
                        ],
                        [
                          'Cumulative layout shift',
                          device.report.metrics.cls,
                          '',
                        ],
                      ] as const
                    ).map(([label, value, unit]) => (
                      <div key={label}>
                        <dt>{label}</dt>
                        <dd>
                          {value === null
                            ? 'Unavailable'
                            : `${unit ? Math.round(value) : Number(value.toFixed(3))}${unit ? ` ${unit}` : ''}`}
                        </dd>
                      </div>
                    ))}
                  </dl>
                  <h4>Suggested improvements</h4>
                  {device.report.opportunities.length ? (
                    <ul>
                      {device.report.opportunities.map((item) => (
                        <li key={item.id}>
                          {item.title} — estimated saving{' '}
                          {Math.round(item.savingsMs)} ms
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p>
                      No timing opportunities returned. This does not mean the
                      page has no performance issues.
                    </p>
                  )}
                </>
              )}
            </article>
          ))}
        </div>
      </section>
      <section className="card monitoring-panel">
        <h2>
          <Icon name="clock" /> Performance history
        </h2>
        <p className="data-note">
          Latest 30 device attempts within 30 days. Failed attempts have no
          score. Previous successful results remain above.
        </p>
        {!data.history.length ? (
          <p>No performance attempts yet.</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col">Started</th>
                  <th scope="col">Device</th>
                  <th scope="col">Score / result</th>
                </tr>
              </thead>
              <tbody>
                {data.history
                  .slice(currentPage * 5, currentPage * 5 + 5)
                  .map((entry) => (
                    <tr key={entry.id}>
                      <td data-label="Started">
                        <Timestamp value={entry.checkedAt} />
                      </td>
                      <td data-label="Device">
                        {entry.strategy === 'mobile' ? 'Mobile' : 'Desktop'}
                      </td>
                      <td data-label="Score / result">
                        {entry.score !== null
                          ? `${entry.score}/100`
                          : entry.errorCode
                            ? (errors[entry.errorCode] ??
                              'Analysis unavailable')
                            : 'Attempt in progress'}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="monitor-pagination">
          <span aria-live="polite">
            {data.history.length
              ? `${currentPage * 5 + 1}–${Math.min(data.history.length, currentPage * 5 + 5)} of ${data.history.length} loaded attempts`
              : 'No records'}
          </span>
          <button
            className="secondary"
            disabled={currentPage === 0}
            onClick={() => setPage(currentPage - 1)}
          >
            Previous
          </button>
          <button
            className="secondary"
            disabled={(currentPage + 1) * 5 >= data.history.length}
            onClick={() => setPage(currentPage + 1)}
          >
            Next
          </button>
        </div>
      </section>
    </>
  );
}
