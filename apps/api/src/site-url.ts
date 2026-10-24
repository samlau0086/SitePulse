import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { isPublicAddress } from '@sitepulse/shared/network';
import { HttpError } from './http-error';

export type ResolveHost = (hostname: string) => Promise<string[]>;
const resolveHost: ResolveHost = async (hostname) =>
  (await lookup(hostname, { all: true, verbatim: true })).map(
    ({ address }) => address,
  );
export function normalizeSiteUrl(input: string) {
  const url = new URL(input);
  const hostname = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash ||
    (!hostname.includes('.') && !isIP(hostname)) ||
    /(^|\.)(localhost|local|internal|test|invalid|example)$/.test(hostname)
  )
    throw new HttpError(
      400,
      'INVALID_SITE_URL',
      'Use a public HTTP(S) site URL without credentials, query, fragment or custom port.',
    );
  url.hostname = isIP(hostname) === 6 ? `[${hostname}]` : hostname;
  url.pathname = url.pathname.replace(/\/+$/, '') || '/';
  return { canonicalUrl: url.toString().replace(/\/$/, ''), hostname };
}
export { isPublicAddress } from '@sitepulse/shared/network';
export async function validateSiteUrl(
  input: string,
  resolve: ResolveHost = resolveHost,
) {
  const normalized = normalizeSiteUrl(input);
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const addresses = isIP(normalized.hostname)
      ? [normalized.hostname]
      : await Promise.race([
          resolve(normalized.hostname),
          new Promise<never>((_, reject) => {
            timeout = setTimeout(() => reject(new Error('DNS timeout')), 3000);
          }),
        ]);
    if (!addresses.length || !addresses.every(isPublicAddress))
      throw new Error('Unsafe address');
  } catch {
    throw new HttpError(
      400,
      'INVALID_SITE_URL',
      'The site must resolve exclusively to public addresses.',
    );
  } finally {
    clearTimeout(timeout);
  }
  // This is registration validation only. No connection is made to this URL.
  return normalized;
}
