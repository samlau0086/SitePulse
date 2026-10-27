import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';

// Server-only: never import this module into a browser bundle.
export function barkDestination(deviceKey: string) {
  return `bark:${createHash('sha256').update(deviceKey).digest('hex')}`;
}

export function encryptBarkKey(
  deviceKey: string,
  key: string,
  organizationId: string,
) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(key, 'hex'), iv);
  cipher.setAAD(Buffer.from(organizationId));
  const ciphertext = Buffer.concat([
    cipher.update(deviceKey, 'utf8'),
    cipher.final(),
  ]);
  return [iv, cipher.getAuthTag(), ciphertext]
    .map((part) => part.toString('base64url'))
    .join('.');
}

export function decryptBarkKey(
  value: string,
  key: string,
  organizationId: string,
) {
  const parts = value.split('.');
  if (parts.length !== 3) throw new Error('BARK_KEY_INVALID');
  const [iv, tag, ciphertext] = parts.map((part) =>
    Buffer.from(part, 'base64url'),
  );
  const cipher = createDecipheriv('aes-256-gcm', Buffer.from(key, 'hex'), iv!);
  cipher.setAAD(Buffer.from(organizationId));
  cipher.setAuthTag(tag!);
  return Buffer.concat([cipher.update(ciphertext!), cipher.final()]).toString(
    'utf8',
  );
}

export type BarkMessage = {
  deviceKey: string;
  title: string;
  body: string;
  url: string;
};
export type SendBark = (message: BarkMessage) => Promise<void>;

// Fixed trusted provider only. No URL/key interpolation, redirects or arbitrary hosts.
export const sendBark: SendBark = async ({ deviceKey, title, body, url }) => {
  const response = await fetch('https://api.day.app/push', {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(10000),
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      device_key: deviceKey,
      title,
      body,
      url,
      group: 'SitePulse',
    }),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error('PROVIDER_REJECTED');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('PROVIDER_INVALID_RESPONSE');
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.length;
      if (length > 4096) throw new Error('PROVIDER_INVALID_RESPONSE');
      chunks.push(chunk.value);
    }
  } finally {
    await reader.cancel();
  }
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new Error('PROVIDER_INVALID_RESPONSE');
  }
  if (
    !payload ||
    typeof payload !== 'object' ||
    !('code' in payload) ||
    payload.code !== 200
  )
    throw new Error('PROVIDER_REJECTED');
};
