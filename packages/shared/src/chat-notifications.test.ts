import { afterEach, expect, it, vi } from 'vitest';
import {
  chatDestination,
  encryptChatSecret,
  decryptChatSecret,
  sendChat,
} from './chat-notifications';

const webhook =
  'https://hooks.slack.com/services/Tfixture/Bfixture/secret_fixture';
const token = `123456:${'x'.repeat(30)}`;
const credentials = JSON.stringify({ botToken: token, chatId: '-10012345' });
const content = {
  title: 'Incident <!channel>',
  body: 'A site is down @everyone',
  url: 'https://pulse.example/verify-notification#token=fixture',
};
afterEach(() => vi.unstubAllGlobals());

it('binds encrypted chat credentials to both tenant and channel with non-reversible destinations', () => {
  const key = 'b'.repeat(64);
  const value = encryptChatSecret(webhook, key, 'tenant', 'slack');
  expect(value).not.toContain(webhook);
  expect(encryptChatSecret(webhook, key, 'tenant', 'slack')).not.toBe(value);
  expect(decryptChatSecret(value, key, 'tenant', 'slack')).toBe(webhook);
  expect(() => decryptChatSecret(value, key, 'other', 'slack')).toThrow();
  expect(() => decryptChatSecret(value, key, 'tenant', 'telegram')).toThrow();
  expect(chatDestination('slack', webhook)).not.toContain('secret_fixture');
  expect(chatDestination('slack', webhook)).not.toBe(
    chatDestination('telegram', webhook),
  );
});

it('posts Slack plain text blocks without mention parsing, and an explicit confirmation link', async () => {
  const fetcher = vi.fn(async () => new Response('ok'));
  vi.stubGlobal('fetch', fetcher);
  await sendChat({ channel: 'slack', secret: webhook, ...content });
  const [endpoint, options] = fetcher.mock.calls[0]! as unknown as [
    string,
    RequestInit,
  ];
  expect(endpoint).toBe(webhook);
  expect(options).toMatchObject({
    method: 'POST',
    redirect: 'error',
    signal: expect.any(AbortSignal),
  });
  const body = JSON.parse(options.body as string);
  expect(body.blocks[0].text).toMatchObject({ type: 'plain_text' });
  expect(body.blocks[1].elements[0].url).toBe(content.url);
  expect(body.text).not.toContain('<!channel>');
});

it('posts Telegram plain text with disabled previews and an inline verification button', async () => {
  const fetcher = vi.fn(async () => new Response('{"ok":true}'));
  vi.stubGlobal('fetch', fetcher);
  await sendChat({ channel: 'telegram', secret: credentials, ...content });
  const [endpoint, options] = fetcher.mock.calls[0]! as unknown as [
    string,
    RequestInit,
  ];
  expect(endpoint).toBe(`https://api.telegram.org/bot${token}/sendMessage`);
  expect(options.redirect).toBe('error');
  const body = JSON.parse(options.body as string);
  expect(body.chat_id).toBe('-10012345');
  expect(body.parse_mode).toBeUndefined();
  expect(body.link_preview_options.is_disabled).toBe(true);
  expect(body.reply_markup.inline_keyboard[0][0].url).toBe(content.url);
});

it.each([
  'http://hooks.slack.com/services/T/B/key',
  'https://hooks.slack.com.evil.test/services/T/B/key',
  'https://hooks.slack.com@127.0.0.1/services/T/B/key',
  'https://hooks.slack.com/services/T/B/key?redirect=http://127.0.0.1',
  'https://hooks.slack.com:443/services/T/B/key',
  'https://hooks.slack.com/services/T/B/key#fragment',
])(
  'rejects unsafe Slack destination %s before network access',
  async (secret) => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    await expect(
      sendChat({ channel: 'slack', secret, ...content }),
    ).rejects.toThrow('PROVIDER_INVALID_CREDENTIAL');
    expect(fetcher).not.toHaveBeenCalled();
  },
);

it('rejects path injection in decrypted Telegram credentials before network access', async () => {
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  await expect(
    sendChat({
      channel: 'telegram',
      secret: JSON.stringify({ botToken: '../getMe', chatId: '123' }),
      ...content,
    }),
  ).rejects.toThrow('PROVIDER_INVALID_CREDENTIAL');
  expect(fetcher).not.toHaveBeenCalled();
});

it.each(['slack', 'telegram'] as const)(
  'sanitizes %s network and provider failures and bounds response sizes',
  async (channel) => {
    const message = {
      channel,
      secret: channel === 'slack' ? webhook : credentials,
      ...content,
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error(`Request failed: ${webhook} ${token}`);
      }),
    );
    await expect(sendChat(message)).rejects.toThrow(/^PROVIDER_UNAVAILABLE$/);
    for (const [status, response] of [
      [429, token],
      [200, 'x'.repeat(32769)],
      [200, '{"ok":false}'],
    ] as const) {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response(response, { status })),
      );
      await expect(sendChat(message)).rejects.toThrow(
        /^PROVIDER_(REJECTED|INVALID_RESPONSE)$/,
      );
    }
  },
);
