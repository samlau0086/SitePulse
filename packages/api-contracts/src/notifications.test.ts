import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  confirmNotificationEndpoint,
  createBarkEndpoint,
  createNotificationEndpoint,
  updateNotificationEndpoint,
  updateNotificationSettings,
} from './index';

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
