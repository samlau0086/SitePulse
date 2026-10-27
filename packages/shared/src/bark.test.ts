import { afterEach, expect, it, vi } from 'vitest';
import {
  barkDestination,
  decryptBarkKey,
  encryptBarkKey,
  sendBark,
} from './bark';

const key = 'a'.repeat(64);
const deviceKey = 'fixture-device-key';
const message = {
  deviceKey,
  title: 'Incident',
  body: 'Confirmed failure',
  url: 'https://pulse.example/app/incidents',
};
afterEach(() => vi.unstubAllGlobals());

it('encrypts keys with randomized authenticated encryption bound to the workspace', () => {
  const value = encryptBarkKey(deviceKey, key, 'workspace');
  expect(value).not.toContain(deviceKey);
  expect(encryptBarkKey(deviceKey, key, 'workspace')).not.toBe(value);
  expect(decryptBarkKey(value, key, 'workspace')).toBe(deviceKey);
  expect(() => decryptBarkKey(value, key, 'other')).toThrow();
  expect(() => decryptBarkKey(value, 'b'.repeat(64), 'workspace')).toThrow();
  const [iv, tag, ciphertext] = value.split('.');
  const changed = Buffer.from(ciphertext!, 'base64url');
  changed[0] = changed[0]! ^ 1;
  expect(() =>
    decryptBarkKey(
      `${iv}.${tag}.${changed.toString('base64url')}`,
      key,
      'workspace',
    ),
  ).toThrow();
  expect(barkDestination(deviceKey)).toBe(barkDestination(deviceKey));
  expect(barkDestination(deviceKey)).not.toContain(deviceKey);
});

it('POSTs credentials only in the body to the fixed HTTPS provider with no redirects and a deadline', async () => {
  const fetcher = vi.fn(
    async () => new Response(JSON.stringify({ code: 200, message: 'success' })),
  );
  vi.stubGlobal('fetch', fetcher);
  await sendBark(message);
  expect(fetcher).toHaveBeenCalledOnce();
  expect(fetcher).toHaveBeenCalledWith(
    'https://api.day.app/push',
    expect.objectContaining({
      method: 'POST',
      redirect: 'error',
      signal: expect.any(AbortSignal),
      body: JSON.stringify({
        device_key: deviceKey,
        title: message.title,
        body: message.body,
        url: message.url,
        group: 'SitePulse',
      }),
    }),
  );
});

it.each([
  [503, '{"code":200}', 'PROVIDER_REJECTED'],
  [
    200,
    '{"code":400,"message":"sensitive-provider-detail"}',
    'PROVIDER_REJECTED',
  ],
  [200, 'not-json', 'PROVIDER_INVALID_RESPONSE'],
  [200, 'x'.repeat(4097), 'PROVIDER_INVALID_RESPONSE'],
  [200, '{}', 'PROVIDER_REJECTED'],
])(
  'rejects HTTP %s and invalid/oversized provider payloads with fixed errors',
  async (status, body, code) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(body, { status })),
    );
    await expect(sendBark(message)).rejects.toThrow(code);
  },
);
