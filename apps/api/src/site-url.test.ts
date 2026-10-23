import { expect, it } from 'vitest';
import { isPublicAddress, normalizeSiteUrl, validateSiteUrl } from './site-url';

it('normalizes hostnames, default ports and WordPress subdirectories', async () => {
  expect(
    await validateSiteUrl(
      'HTTPS://Wp.Public-Domain.COM:443/blog/',
      async () => ['8.8.8.8'],
    ),
  ).toEqual({
    hostname: 'wp.public-domain.com',
    canonicalUrl: 'https://wp.public-domain.com/blog',
  });
  expect(normalizeSiteUrl('https://wp.public-domain.com./')).toEqual({
    hostname: 'wp.public-domain.com',
    canonicalUrl: 'https://wp.public-domain.com',
  });
});
it.each([
  'http://127.0.0.1',
  'http://2130706433',
  'http://0x7f000001',
  'http://10.1.2.3',
  'http://169.254.169.254',
  'http://[::1]',
  'http://[::ffff:127.0.0.1]',
  'http://[fc00::1]',
  'https://localhost',
  'https://wp.local',
  'https://a.com:8080',
  'ftp://a.com',
  'https://u:p@a.com',
  'https://a.com?q=1',
  'https://a.com/#fragment',
])('rejects unsafe registration URL %s', async (url) => {
  await expect(
    validateSiteUrl(url, async () => ['127.0.0.1']),
  ).rejects.toThrow();
});
it('rejects mixed public/private DNS, unresolved hosts and DNS failures', async () => {
  for (const addresses of [
    [],
    ['8.8.8.8', '10.0.0.1'],
    ['::ffff:10.0.0.1'],
    ['2001:db8::1'],
    ['192.0.2.1'],
  ]) {
    await expect(
      validateSiteUrl('https://wp.public-domain.com', async () => addresses),
    ).rejects.toThrow();
  }
  await expect(
    validateSiteUrl('https://wp.public-domain.com', async () => {
      throw new Error('DNS failure');
    }),
  ).rejects.toThrow();
  expect(isPublicAddress('not-an-ip')).toBe(false);
  expect(isPublicAddress('2606:4700:4700::1111')).toBe(true);
});
