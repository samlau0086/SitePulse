import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { NotificationSettings } from '../components/notification-settings';
import { NotificationVerification } from '../components/notification-verification';
import { AppNavigation } from '../components/app-navigation';
vi.mock('next/navigation', () => ({
  usePathname: () => '/app/notifications',
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock('next/link', () => ({ default: 'a' }));

it('provides direct active notification navigation', () => {
  expect(renderToStaticMarkup(createElement(AppNavigation))).toContain(
    'href="/app/notifications" aria-current="page"',
  );
});
it('renders multiple Slack and Telegram recipients by label with credentials hidden', () => {
  const html = renderToStaticMarkup(
    createElement(NotificationSettings, {
      organizationId: 'workspace',
      initial: {
        canManage: false,
        includeMembers: false,
        memberEmails: [],
        endpoints: (['slack', 'telegram'] as const).flatMap((type) =>
          [1, 2].map((index) => ({
            id: `${type}-${index}`,
            type,
            label: `${type} recipient ${index}`,
            destination: 'secret-server-fingerprint-must-not-render',
            enabled: true,
            verifiedAt: index === 1 ? '2026-10-28' : null,
            lastMailAt: null,
          })),
        ),
      },
    }),
  );
  for (const text of [
    'slack recipient 1',
    'slack recipient 2',
    'telegram recipient 1',
    'telegram recipient 2',
    'Slack · credentials hidden',
    'Telegram · credentials hidden',
    'Send test message',
    'Resend verification',
  ])
    expect(html).toContain(text);
  expect(html).not.toContain('secret-server-fingerprint');
  expect(html).toContain('Only verified workspace owners');
  expect(html).toContain('disabled=""');
});
it('renders recipient state, permissions and pending/test restrictions without exposing tokens', () => {
  const html = renderToStaticMarkup(
    createElement(NotificationSettings, {
      organizationId: 'workspace',
      initial: {
        canManage: false,
        includeMembers: true,
        memberEmails: ['member@example.com'],
        endpoints: [
          {
            id: 'endpoint',
            type: 'email',
            label: null,
            destination: 'client@example.com',
            enabled: true,
            verifiedAt: null,
            lastMailAt: null,
          },
        ],
      },
    }),
  );
  expect(html).toContain('Pending verification');
  expect(html).toContain('Only verified workspace owners');
  expect(html).toContain('disabled=""');
  expect(html).toContain('Resend verification');
  expect(html).toContain('Send test email');
  expect(html).not.toContain('tokenHash');
});
it('requires explicit opt-in confirmation and does not imply workspace authorization', () => {
  const html = renderToStaticMarkup(createElement(NotificationVerification));
  expect(html).toContain('Confirm alert recipient');
  expect(html).toContain(
    'does not create an account or grant workspace access',
  );
  expect(html).toContain('disabled=""');
});

it('renders multiple Bark devices with hidden keys and the same verification and management controls', () => {
  const html = renderToStaticMarkup(
    createElement(NotificationSettings, {
      organizationId: 'workspace',
      initial: {
        canManage: true,
        includeMembers: false,
        memberEmails: [],
        endpoints: [
          {
            id: 'phone',
            type: 'bark',
            label: 'Personal iPhone',
            destination: 'Bark device (key hidden)',
            enabled: true,
            verifiedAt: '2026-10-27',
            lastMailAt: null,
          },
          {
            id: 'tablet',
            type: 'bark',
            label: 'Team iPad',
            destination: 'Bark device (key hidden)',
            enabled: false,
            verifiedAt: null,
            lastMailAt: null,
          },
        ],
      },
    }),
  );
  expect(html).toContain('Personal iPhone');
  expect(html).toContain('Team iPad');
  expect(html).toContain('Send test push');
  expect(html).toContain('type="password"');
  expect(html).toContain('Self-hosted servers');
  expect(html).not.toContain('encryptedKey');
  expect(html).not.toContain('device_key');
});
