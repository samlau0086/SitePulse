import { createHash } from 'node:crypto';
import { encryptBarkKey, decryptBarkKey } from './bark';

export type ChatChannel = 'slack' | 'telegram';
export type ChatMessage = {
  channel: ChatChannel;
  secret: string;
  title: string;
  body: string;
  url: string;
};
export type SendChat = (message: ChatMessage) => Promise<void>;
export const encryptChatSecret = (
  secret: string,
  key: string,
  organizationId: string,
  channel: ChatChannel,
) => encryptBarkKey(secret, key, `${organizationId}:${channel}`);
export const decryptChatSecret = (
  secret: string,
  key: string,
  organizationId: string,
  channel: ChatChannel,
) => decryptBarkKey(secret, key, `${organizationId}:${channel}`);
export const chatDestination = (channel: ChatChannel, secret: string) =>
  `${channel}:${createHash('sha256').update(secret).digest('hex')}`;

// Bound success responses as well as errors; never persist provider bodies or URLs.
async function responseText(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('PROVIDER_INVALID_RESPONSE');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 32768) throw new Error('PROVIDER_INVALID_RESPONSE');
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  return Buffer.concat(chunks).toString('utf8');
}

export const sendChat: SendChat = async ({
  channel,
  secret,
  title,
  body,
  url,
}) => {
  try {
    let endpoint: string;
    let payload: object;
    if (channel === 'slack') {
      // Validate again at the outbound boundary, including after decrypting stored data.
      if (
        !/^https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+$/.test(
          secret,
        )
      )
        throw new Error('PROVIDER_INVALID_CREDENTIAL');
      endpoint = secret;
      const text = `${title}\n${body}\n${url}`.slice(0, 2900);
      // Plain text blocks prevent site names/URLs from injecting mentions or mrkdwn.
      payload = {
        text: 'SitePulse notification',
        blocks: [
          { type: 'section', text: { type: 'plain_text', text, emoji: false } },
          {
            type: 'actions',
            elements: [
              {
                type: 'button',
                text: { type: 'plain_text', text: 'Open SitePulse' },
                url,
              },
            ],
          },
        ],
      };
    } else {
      const credentials: unknown = JSON.parse(secret);
      if (
        !credentials ||
        typeof credentials !== 'object' ||
        !('botToken' in credentials) ||
        !('chatId' in credentials) ||
        typeof credentials.botToken !== 'string' ||
        typeof credentials.chatId !== 'string' ||
        !/^[0-9]{5,20}:[A-Za-z0-9_-]{20,100}$/.test(credentials.botToken) ||
        !/^-?[1-9][0-9]{0,19}$/.test(credentials.chatId)
      )
        throw new Error('PROVIDER_INVALID_CREDENTIAL');
      endpoint = `https://api.telegram.org/bot${credentials.botToken}/sendMessage`;
      payload = {
        chat_id: credentials.chatId,
        text: `${title}\n${body}`.slice(0, 3500),
        link_preview_options: { is_disabled: true },
        reply_markup: { inline_keyboard: [[{ text: 'Open SitePulse', url }]] },
      };
    }
    const response = await fetch(endpoint, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error('PROVIDER_REJECTED');
    }
    const text = await responseText(response);
    if (channel === 'slack') {
      if (text.trim() !== 'ok') throw new Error('PROVIDER_REJECTED');
    } else {
      const result: unknown = JSON.parse(text);
      if (
        !result ||
        typeof result !== 'object' ||
        !('ok' in result) ||
        result.ok !== true
      )
        throw new Error('PROVIDER_REJECTED');
    }
  } catch (error) {
    // Fetch exceptions can contain webhook URLs / bot tokens. Never propagate them.
    const code =
      error instanceof Error &&
      [
        'PROVIDER_REJECTED',
        'PROVIDER_INVALID_RESPONSE',
        'PROVIDER_INVALID_CREDENTIAL',
      ].includes(error.message)
        ? error.message
        : 'PROVIDER_UNAVAILABLE';
    // Deliberately omit cause: provider exceptions may embed secret URLs or tokens.
    // eslint-disable-next-line preserve-caught-error
    throw new Error(code);
  }
};
