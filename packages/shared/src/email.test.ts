import { expect, it } from 'vitest';
import { emailHtml, validLogoUrl } from './email';

it('accepts only bounded HTTPS logo hosts without credentials or local literals', () => {
  expect(validLogoUrl('https://cdn.example.com/brand.png?v=2')).toBe(true);
  for (const value of [
    'http://example.com/a.png',
    'javascript:alert(1)',
    'data:image/png;base64,AAAA',
    'https://user:pass@example.com/a.png',
    'https://127.0.0.1/logo',
    'https://[::1]/logo',
    'https://localhost/logo',
    'https://host.internal/logo',
    'https://example.com:444/logo',
    'https://example.com/logo#x',
    'https://example.com/\nlogo',
    `https://example.com/${'x'.repeat(2048)}`,
  ]) {
    expect(validLogoUrl(value), value).toBe(false);
  }
});
it('escapes brand, site and action content and keeps a usable fallback link', () => {
  const html = emailHtml({
    brand: {
      name: '<img onerror="x">',
      logoUrl: 'https://cdn.example.com/logo.png?a=1&b=2',
    },
    title: '<script>bad</script>',
    text: 'First\nSecond <iframe>',
    actionLabel: 'Open & confirm',
    actionUrl: 'https://app.example.com/verify#token=a&next=b',
  });
  expect(html).not.toContain('<script>');
  expect(html).not.toContain('<iframe>');
  expect(html).toContain('&lt;img onerror=&quot;x&quot;&gt;');
  expect(html).toContain('First<br>Second');
  expect(html).toContain('https://app.example.com/verify#token=a&amp;next=b');
  expect(html).toContain('role="presentation"');
  expect(html).toContain('Open &amp; confirm');
});
it('does not render dangerous image sources or action schemes', () => {
  const html = emailHtml({
    brand: { name: 'Agency', logoUrl: 'javascript:bad' },
    title: 'Alert',
    text: 'Details',
    actionUrl: 'javascript:bad',
    actionLabel: 'View',
    status: 'attention',
  });
  expect(html).not.toContain('<img');
  expect(html).not.toContain('javascript:');
  expect(html).toContain('NEEDS ATTENTION');
});
