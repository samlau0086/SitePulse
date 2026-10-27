import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  confirmNotificationEndpoint,
  createBarkEndpoint,
  createSlackEndpoint,
  createTelegramEndpoint,
  createNotificationEndpoint,
  updateNotificationEndpoint,
  updateNotificationSettings,
} from './index';

it('accepts only official Slack webhook URLs and rejects forged verification state', () => {
  const input = {
    label: 'Ops',
    webhookUrl: 'https://hooks.slack.com/services/T123/B123/fixture',
  };
  expect(createSlackEndpoint.safeParse(input).success).toBe(true);
  for (const webhookUrl of [
    'http://127.0.0.1/',
    `${input.webhookUrl}?x=1`,
    `${input.webhookUrl}#fragment`,
    'https://hooks.slack.com.evil.test/services/T/B/x',
    'https://hooks.slack.com:443/services/T/B/x',
  ])
    expect(
      createSlackEndpoint.safeParse({ ...input, webhookUrl }).success,
    ).toBe(false);
  expect(
    createSlackEndpoint.safeParse({ ...input, verifiedAt: 'now' }).success,
  ).toBe(false);
});
it('validates bounded Telegram credentials and numeric private/group IDs', () => {
  const input = {
    label: 'On-call',
    botToken: `123456:${'x'.repeat(30)}`,
    chatId: '-10012345',
  };
  expect(createTelegramEndpoint.safeParse(input).success).toBe(true);
  expect(
    createTelegramEndpoint.safeParse({ ...input, chatId: '123456' }).success,
  ).toBe(true);
  for (const chatId of ['@username', '0', '123/456', '1'.repeat(21)])
    expect(createTelegramEndpoint.safeParse({ ...input, chatId }).success).toBe(
      false,
    );
  expect(
    createTelegramEndpoint.safeParse({
      ...input,
      botToken: 'https://api.telegram.org/token',
    }).success,
  ).toBe(false);
  expect(
    createTelegramEndpoint.safeParse({ ...input, organizationId: randomUUID() })
      .success,
  ).toBe(false);
});

it('accepts only bounded Bark device keys and labels, never URLs or client verification state', () => {
  expect(
    createBarkEndpoint.parse({
      label: ' My phone ',
      deviceKey: ' FixtureDeviceKey ',
    }),
  ).toEqual({ label: 'My phone', deviceKey: 'FixtureDeviceKey' });
  for (const deviceKey of [
    'https://api.day.app/key',
    'http://127.0.0.1/key',
    'a/b',
    'a'.repeat(257),
    'short',
    'a\r\nheader',
  ])
    expect(
      createBarkEndpoint.safeParse({ label: 'Phone', deviceKey }).success,
    ).toBe(false);
  for (const input of [
    { label: '', deviceKey: 'FixtureDeviceKey' },
    { label: 'Phone', deviceKey: 'FixtureDeviceKey', verifiedAt: 'now' },
    {
      label: 'Phone',
      deviceKey: 'FixtureDeviceKey',
      server: 'https://internal/',
    },
  ])
    expect(createBarkEndpoint.safeParse(input).success).toBe(false);
});

it('normalizes recipient addresses and rejects header injection and forged verification state', () => {
  expect(
    createNotificationEndpoint.parse({ destination: ' Client@Example.com ' }),
  ).toEqual({ destination: 'client@example.com' });
  for (const destination of [
    'bad',
    'a@example.com\r\nBcc: b@example.com',
    'a'.repeat(255) + '@example.com',
  ])
    expect(createNotificationEndpoint.safeParse({ destination }).success).toBe(
      false,
    );
  expect(
    createNotificationEndpoint.safeParse({
      destination: 'a@example.com',
      verifiedAt: 'now',
    }).success,
  ).toBe(false);
});
it('strictly validates endpoint and workspace controls and bounded opt-in proofs', () => {
  expect(updateNotificationEndpoint.safeParse({ enabled: false }).success).toBe(
    true,
  );
  expect(
    updateNotificationEndpoint.safeParse({ enabled: 'true' }).success,
  ).toBe(false);
  expect(
    updateNotificationEndpoint.safeParse({
      enabled: true,
      organizationId: randomUUID(),
    }).success,
  ).toBe(false);
  expect(
    updateNotificationSettings.safeParse({ includeMembers: false }).success,
  ).toBe(true);
  expect(
    updateNotificationSettings.safeParse({
      includeMembers: true,
      actorUserId: randomUUID(),
    }).success,
  ).toBe(false);
  expect(
    confirmNotificationEndpoint.safeParse({
      endpointId: randomUUID(),
      token: 'x'.repeat(43),
    }).success,
  ).toBe(true);
  expect(
    confirmNotificationEndpoint.safeParse({
      endpointId: randomUUID(),
      token: 'x'.repeat(10000),
    }).success,
  ).toBe(false);
});
