import { createServer } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { afterEach, expect, it, vi } from 'vitest';
import {
  pinnedHttp,
  probe,
  publicDestination,
  sslResult,
  type ProbeDependencies,
} from './probe';

const target = 'https://wp.customer-domain.com/blog';
const dependencies = (): ProbeDependencies => ({
  resolve: vi.fn(async () => ['8.8.8.8']),
  http: vi.fn(async () => ({ status: 200 })),
  ssl: vi.fn(async () => new Date(Date.now() + 90 * 86400000)),
});
afterEach(() => vi.useRealTimers());

it.each([
  '127.0.0.1',
  '10.0.0.1',
  '172.16.0.1',
  '192.168.1.1',
  '169.254.169.254',
  '100.100.100.200',
  '0.0.0.0',
  '224.0.0.1',
  '192.0.2.1',
  '198.18.0.1',
  '::1',
  'fc00::1',
  'fe80::1',
  'ff02::1',
  '::ffff:127.0.0.1',
  '64:ff9b::a00:1',
  '2001:db8::1',
])('blocks non-public DNS answer %s before any connection', async (address) => {
  const deps = dependencies();
  deps.resolve = async () => ['8.8.8.8', address];
  expect(await probe(target, 'uptime', deps)).toMatchObject({
    result: 'error',
    errorCode: 'UNSAFE_DESTINATION',
  });
  expect(deps.http).not.toHaveBeenCalled();
});
it.each([
  'http://user:pass@public.customer-domain.com',
  'http://customer-domain.com:8080',
  'file:///etc/passwd',
  'http://2130706433',
  'http://[::ffff:7f00:1]',
  'http://localhost',
  'http://customer-domain.com.internal',
])('blocks unsafe URL %s', async (url) => {
  const deps = dependencies();
  expect((await probe(url, 'uptime', deps)).result).toBe('error');
  expect(deps.http).not.toHaveBeenCalled();
});
it('passes only the approved address to transport and preserves hostname', async () => {
  const deps = dependencies();
  await probe(target, 'uptime', deps);
  expect(deps.resolve).toHaveBeenCalledTimes(1);
  expect(deps.http).toHaveBeenCalledWith(
    expect.objectContaining({
      hostname: 'wp.customer-domain.com',
      address: '8.8.8.8',
    }),
    expect.any(AbortSignal),
  );
});
it('revalidates same-host redirect DNS and blocks rebinding before a second connection', async () => {
  const deps = dependencies();
  let resolutions = 0;
  deps.resolve = async () =>
    ++resolutions === 1 ? ['8.8.8.8'] : ['127.0.0.1'];
  deps.http = vi.fn(async () => ({ status: 302, location: '/admin' }));
  expect(await probe(target, 'uptime', deps)).toMatchObject({
    errorCode: 'UNSAFE_DESTINATION',
  });
  expect(deps.http).toHaveBeenCalledTimes(1);
});
it.each([
  'http://169.254.169.254/latest/meta-data',
  'https://127.0.0.1',
  'https://user:password@public.customer-domain.com',
  'https://public.customer-domain.com:8443',
])('blocks redirect to %s', async (location) => {
  const deps = dependencies();
  deps.http = vi.fn(async () => ({ status: 302, location }));
  expect((await probe(target, 'uptime', deps)).result).toBe('error');
  expect(deps.http).toHaveBeenCalledTimes(1);
});
it('follows a validated public redirect, allows relative paths, and bounds loops', async () => {
  const deps = dependencies();
  let calls = 0;
  deps.http = vi.fn(async () =>
    ++calls === 1 ? { status: 302, location: '/new?x=1' } : { status: 204 },
  );
  expect(await probe(target, 'uptime', deps)).toMatchObject({
    result: 'up',
    httpStatus: 204,
  });
  deps.http = vi.fn(async () => ({ status: 301, location: '/loop' }));
  expect(await probe(target, 'uptime', deps)).toMatchObject({
    errorCode: 'REDIRECT_LIMIT',
  });
  expect(deps.http).toHaveBeenCalledTimes(4);
});
it('rejects HTTPS downgrade redirects', async () => {
  const deps = dependencies();
  deps.http = async () => ({
    status: 301,
    location: 'http://wp.customer-domain.com/',
  });
  expect(await probe(target, 'uptime', deps)).toMatchObject({
    errorCode: 'HTTPS_DOWNGRADE',
  });
});
it('bounds slow DNS and prevents connection when it eventually completes', async () => {
  vi.useFakeTimers();
  const deps = dependencies();
  let finish!: (addresses: string[]) => void;
  deps.resolve = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  const pending = probe(target, 'uptime', deps);
  await vi.advanceTimersByTimeAsync(10001);
  expect(await pending).toMatchObject({
    result: 'error',
    errorCode: 'TIMEOUT',
  });
  finish(['8.8.8.8']);
  await vi.advanceTimersByTimeAsync(0);
  expect(deps.http).not.toHaveBeenCalled();
});
it('aborts a slow transport within the total budget', async () => {
  vi.useFakeTimers();
  const deps = dependencies();
  let signal: AbortSignal | undefined;
  deps.http = async (_destination, value) => {
    signal = value;
    return new Promise(() => {});
  };
  const pending = probe(target, 'uptime', deps);
  await vi.advanceTimersByTimeAsync(10001);
  expect(await pending).toMatchObject({ errorCode: 'TIMEOUT' });
  expect(signal?.aborted).toBe(true);
});
it('classifies HTTP failures and never returns arbitrary exception messages', async () => {
  const deps = dependencies();
  deps.http = async () => ({ status: 503 });
  expect(await probe(target, 'uptime', deps)).toMatchObject({
    result: 'down',
    httpStatus: 503,
  });
  deps.http = async () => {
    throw new Error('sensitive internal address and request');
  };
  expect(JSON.stringify(await probe(target, 'uptime', deps))).not.toContain(
    'sensitive',
  );
});
it('validates TLS results, expiry thresholds and sanitized certificate errors', async () => {
  const deps = dependencies();
  expect((await probe(target, 'ssl', deps)).result).toBe('up');
  expect(deps.http).not.toHaveBeenCalled();
  for (const [days, code] of [
    [14, 'TLS_EXPIRING_14D'],
    [7, 'TLS_EXPIRING_7D'],
    [3, 'TLS_EXPIRING_3D'],
    [-1, 'TLS_EXPIRED'],
  ] as const) {
    expect(sslResult(new Date(100000 + days * 86400000), 100000)).toMatchObject(
      { errorCode: code, result: days < 0 ? 'down' : 'warning' },
    );
  }
  for (const code of [
    'CERT_HAS_EXPIRED',
    'ERR_TLS_CERT_ALTNAME_INVALID',
    'DEPTH_ZERO_SELF_SIGNED_CERT',
  ]) {
    deps.ssl = async () => {
      throw Object.assign(new Error('private TLS details'), { code });
    };
    expect(await probe(target, 'ssl', deps)).toMatchObject({
      result: 'error',
      errorCode: code === 'CERT_HAS_EXPIRED' ? 'TLS_EXPIRED' : 'TLS_INVALID',
    });
  }
  expect(
    await probe('http://wp.customer-domain.com', 'ssl', deps),
  ).toMatchObject({ errorCode: 'HTTPS_REQUIRED' });
});
it('pins the actual HTTP connection, preserves Host, and stops without downloading the response body', async () => {
  // Only this transport harness uses loopback; the production entry validates all addresses first.
  let host: string | undefined;
  const server = createServer((request, response) => {
    host = request.headers.host;
    response.writeHead(200);
    response.flushHeaders();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;
  try {
    const response = await pinnedHttp(
      {
        url: new URL(`http://wp.customer-domain.com:${port}/`),
        hostname: 'wp.customer-domain.com',
        address: '127.0.0.1',
      },
      AbortSignal.timeout(2000),
    );
    expect(response.status).toBe(200);
    expect(host).toBe(`wp.customer-domain.com:${port}`);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
it('rejects an empty DNS set', async () => {
  await expect(publicDestination(target, async () => [])).rejects.toThrow(
    'UNSAFE_DESTINATION',
  );
});
