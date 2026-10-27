import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  confirmNotificationEndpoint,
  createNotificationEndpoint,
  updateNotificationEndpoint,
  updateNotificationSettings,
} from './index';

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
