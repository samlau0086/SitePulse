import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import tls from 'node:tls';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { pinnedSsl, type Destination } from './probe';

let directory: string;
let server: tls.Server;
let certificate: Buffer;
let port: number;
const connect = tls.connect.bind(tls);
beforeAll(async () => {
  // Ephemeral test-only keys never enter the repository or logs.
  directory = mkdtempSync(join(tmpdir(), 'sitepulse-tls-test-'));
  writeFileSync(
    join(directory, 'openssl.cnf'),
    '[req]\ndistinguished_name=dn\n[dn]\n',
  );
  const openssl =
    process.env.OPENSSL_BIN ??
    (process.platform === 'win32' &&
    existsSync('C:/Program Files/Git/usr/bin/openssl.exe')
      ? 'C:/Program Files/Git/usr/bin/openssl.exe'
      : 'openssl');
  execFileSync(
    openssl,
    [
      'req',
      '-config',
      join(directory, 'openssl.cnf'),
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      join(directory, 'key.pem'),
      '-out',
      join(directory, 'cert.pem'),
      '-subj',
      '/CN=monitor.test',
      '-addext',
      'subjectAltName=DNS:monitor.test',
      '-days',
      '2',
    ],
    { stdio: 'ignore', timeout: 10000 },
  );
  certificate = readFileSync(join(directory, 'cert.pem'));
  server = tls.createServer(
    { key: readFileSync(join(directory, 'key.pem')), cert: certificate },
    (socket) => socket.on('error', () => {}),
  );
  server.on('tlsClientError', () => {});
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  port = (server.address() as AddressInfo).port;
});
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  if (server)
    await new Promise<void>((resolve) => server.close(() => resolve()));
  if (directory) rmSync(directory, { recursive: true });
});
function destination(hostname: string): Destination {
  return {
    hostname,
    address: '127.0.0.1',
    url: new URL(`https://${hostname}`),
  };
}
function localTransport(trust: boolean) {
  // Reroute only the low-level test socket to our fixture; production checks stay strict.
  vi.spyOn(tls, 'connect').mockImplementation(((
    options: tls.ConnectionOptions,
    listener: () => void,
  ) => {
    expect(options.rejectUnauthorized).toBe(true);
    expect(options.host).toBe('127.0.0.1');
    expect(options.port).toBe(443);
    return connect(
      { ...options, port, ...(trust ? { ca: certificate } : {}) },
      listener,
    );
  }) as typeof tls.connect);
}
it('reads certificate expiry from a real verified handshake with the original hostname', async () => {
  localTransport(true);
  const expires = await pinnedSsl(
    destination('monitor.test'),
    AbortSignal.timeout(2000),
  );
  expect(expires.getTime()).toBeGreaterThan(Date.now());
  expect(expires.getTime()).toBeLessThan(Date.now() + 3 * 86400000);
});
it('rejects a trusted certificate belonging to a different hostname', async () => {
  localTransport(true);
  await expect(
    pinnedSsl(destination('different.test'), AbortSignal.timeout(2000)),
  ).rejects.toMatchObject({ code: 'ERR_TLS_CERT_ALTNAME_INVALID' });
});
it('rejects an untrusted certificate chain', async () => {
  localTransport(false);
  await expect(
    pinnedSsl(destination('monitor.test'), AbortSignal.timeout(2000)),
  ).rejects.toMatchObject({ code: 'DEPTH_ZERO_SELF_SIGNED_CERT' });
});
