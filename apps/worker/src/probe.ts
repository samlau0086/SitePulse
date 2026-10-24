import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';
import { isPublicAddress } from '@sitepulse/shared/network';

export type ProbeResult = {
  result: 'up' | 'down' | 'warning' | 'error';
  httpStatus?: number;
  latencyMs?: number;
  sslExpiresAt?: Date;
  errorCode?: string;
};
export type Destination = { url: URL; hostname: string; address: string };
type Hop = { status: number; location?: string };
export type ProbeDependencies = {
  resolve: (hostname: string) => Promise<string[]>;
  http: (destination: Destination, signal: AbortSignal) => Promise<Hop>;
  ssl: (destination: Destination, signal: AbortSignal) => Promise<Date>;
};
class ProbeError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

export async function publicDestination(
  input: string,
  resolve: ProbeDependencies['resolve'],
): Promise<Destination> {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new ProbeError('UNSAFE_DESTINATION');
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.port ||
    input.length > 2048 ||
    /(^|\.)(localhost|local|internal|test|invalid|example)$/.test(hostname)
  )
    throw new ProbeError('UNSAFE_DESTINATION');
  const addresses = isIP(hostname) ? [hostname] : await resolve(hostname);
  if (!addresses.length || !addresses.every(isPublicAddress))
    throw new ProbeError('UNSAFE_DESTINATION');
  return { url, hostname, address: addresses[0]! };
}

// Fresh sockets only. The OS never resolves the hostname during connection.
export function pinnedHttp(
  { url, hostname, address }: Destination,
  signal: AbortSignal,
): Promise<Hop> {
  return new Promise((resolve, reject) => {
    const request = (url.protocol === 'https:' ? https : http).request(
      url,
      {
        method: 'GET',
        agent: false,
        signal,
        lookup: (_host, _options, callback) =>
          callback(null, address, isIP(address)),
        family: isIP(address),
        servername: isIP(hostname) ? undefined : hostname,
        rejectUnauthorized: true,
        maxHeaderSize: 16384,
        headers: {
          'user-agent': 'SitePulse-Monitor/0.1',
          range: 'bytes=0-65535',
          accept: '*/*',
        },
      },
      (response) => {
        // Inspect headers only; never download or persist customer response bodies.
        resolve({
          status: response.statusCode ?? 0,
          location: response.headers.location,
        });
        response.destroy();
      },
    );
    request.on('error', reject);
    request.setTimeout(5000, () => request.destroy(new ProbeError('TIMEOUT')));
    request.end();
  });
}

export function pinnedSsl(
  { hostname, address }: Destination,
  signal: AbortSignal,
): Promise<Date> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new ProbeError('TIMEOUT'));
      return;
    }
    const socket = tls.connect(
      {
        host: address,
        port: 443,
        servername: isIP(hostname) ? undefined : hostname,
        rejectUnauthorized: true,
        checkServerIdentity: (_host, cert) =>
          tls.checkServerIdentity(hostname, cert),
      },
      () => {
        const certificate = socket.getPeerCertificate();
        // Explicit check also covers literal IP targets with no SNI.
        const identityError = tls.checkServerIdentity(hostname, certificate);
        const expires = new Date(certificate.valid_to);
        if (identityError || !Number.isFinite(expires.getTime()))
          reject(new ProbeError('TLS_INVALID'));
        else resolve(expires);
        socket.destroy();
      },
    );
    socket.on('error', reject);
    const abort = () => {
      socket.destroy(new ProbeError('TIMEOUT'));
    };
    signal.addEventListener('abort', abort, { once: true });
    socket.once('close', () => signal.removeEventListener('abort', abort));
    socket.setTimeout(5000, () => socket.destroy(new ProbeError('TIMEOUT')));
  });
}

const defaults: ProbeDependencies = {
  resolve: async (hostname) =>
    (await lookup(hostname, { all: true, verbatim: true })).map(
      (entry) => entry.address,
    ),
  http: pinnedHttp,
  ssl: pinnedSsl,
};
export function sslResult(expires: Date, now = Date.now()): ProbeResult {
  const days = (expires.getTime() - now) / 86400000;
  return {
    result: days <= 0 ? 'down' : days <= 14 ? 'warning' : 'up',
    sslExpiresAt: expires,
    ...(days <= 14
      ? {
          errorCode:
            days <= 0
              ? 'TLS_EXPIRED'
              : days <= 3
                ? 'TLS_EXPIRING_3D'
                : days <= 7
                  ? 'TLS_EXPIRING_7D'
                  : 'TLS_EXPIRING_14D',
        }
      : {}),
  };
}
function safeError(error: unknown): string {
  if (error instanceof ProbeError) return error.code;
  const code = (error as NodeJS.ErrnoException)?.code;
  if (code === 'ABORT_ERR') return 'TIMEOUT';
  if (code === 'CERT_HAS_EXPIRED') return 'TLS_EXPIRED';
  if (
    code?.startsWith('ERR_TLS') ||
    code?.includes('CERT') ||
    code?.includes('SELF_SIGNED')
  )
    return 'TLS_INVALID';
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'DNS_FAILED';
  return 'CONNECTION_FAILED';
}

export async function probe(
  input: string,
  type: 'uptime' | 'ssl',
  dependencies: ProbeDependencies = defaults,
): Promise<ProbeResult> {
  const started = Date.now();
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      (async (): Promise<ProbeResult> => {
        let destination = await publicDestination(input, dependencies.resolve);
        if (controller.signal.aborted) throw new ProbeError('TIMEOUT');
        if (type === 'ssl') {
          if (destination.url.protocol !== 'https:')
            throw new ProbeError('HTTPS_REQUIRED');
          return {
            ...sslResult(
              await dependencies.ssl(destination, controller.signal),
            ),
            latencyMs: Date.now() - started,
          };
        }
        for (let redirects = 0; redirects <= 3; redirects++) {
          if (controller.signal.aborted) throw new ProbeError('TIMEOUT');
          const hop = await dependencies.http(destination, controller.signal);
          if ([301, 302, 303, 307, 308].includes(hop.status)) {
            if (!hop.location || redirects === 3)
              throw new ProbeError('REDIRECT_LIMIT');
            const next = await publicDestination(
              new URL(hop.location, destination.url).toString(),
              dependencies.resolve,
            );
            if (
              destination.url.protocol === 'https:' &&
              next.url.protocol !== 'https:'
            )
              throw new ProbeError('HTTPS_DOWNGRADE');
            destination = next;
            continue;
          }
          return {
            result: hop.status >= 200 && hop.status < 400 ? 'up' : 'down',
            httpStatus: hop.status,
            latencyMs: Date.now() - started,
            ...(hop.status >= 400 ? { errorCode: 'HTTP_STATUS' } : {}),
          };
        }
        throw new ProbeError('REDIRECT_LIMIT');
      })(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new ProbeError('TIMEOUT'));
        }, 10000);
      }),
    ]);
  } catch (error) {
    return {
      result: 'error',
      errorCode: safeError(error),
      latencyMs: Date.now() - started,
    };
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
