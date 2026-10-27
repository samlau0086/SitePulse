import { describe, expect, it } from 'vitest';
import {
  parseEnvironment,
  parseWebEnvironment,
  parseWorkerEnvironment,
} from './index';

const valid = {
  DATABASE_URL: 'postgres://test:test@localhost/sitepulse_test',
  APP_ORIGIN: 'http://localhost:3000',
  BETTER_AUTH_SECRET: 'a'.repeat(48),
};
describe('environment validation', () => {
  it('defaults to no platform administrators and validates stable UUID allowlists', () => {
    const id = 'd67deea0-0c5f-4f36-b47b-b57dc3b548c0';
    expect(parseEnvironment(valid).PLATFORM_ADMIN_USER_IDS).toEqual([]);
    expect(
      parseEnvironment({
        ...valid,
        PLATFORM_ADMIN_USER_IDS: ` ${id.toUpperCase()},${id} `,
      }).PLATFORM_ADMIN_USER_IDS,
    ).toEqual([id, id]);
    for (const value of [
      'owner',
      'admin@example.com',
      `${id},`,
      `${id}\nFORGED=true`,
    ])
      expect(() =>
        parseEnvironment({ ...valid, PLATFORM_ADMIN_USER_IDS: value }),
      ).toThrow('PLATFORM_ADMIN_USER_IDS');
  });
  it('validates monitoring switches and interval bounds without Boolean coercion', () => {
    expect(parseWorkerEnvironment(valid).MONITOR_INTERVAL_SECONDS).toBe(300);
    for (const seconds of ['60', '300', '3600'])
      expect(
        parseWorkerEnvironment({ ...valid, MONITOR_INTERVAL_SECONDS: seconds })
          .MONITOR_INTERVAL_SECONDS,
      ).toBe(Number(seconds));
    expect(parseWorkerEnvironment(valid).MONITORING_ENABLED).toBe(true);
    expect(
      parseWorkerEnvironment({ ...valid, MONITORING_ENABLED: 'false' })
        .MONITORING_ENABLED,
    ).toBe(false);
    for (const input of [
      { MONITORING_ENABLED: 'yes' },
      { MONITOR_INTERVAL_SECONDS: '1' },
      { MONITOR_INTERVAL_SECONDS: '59' },
      { MONITOR_INTERVAL_SECONDS: '3601' },
      { MONITOR_INTERVAL_SECONDS: '60.5' },
      { SSL_INTERVAL_SECONDS: '0' },
    ])
      expect(() => parseWorkerEnvironment({ ...valid, ...input })).toThrow(
        'Invalid worker',
      );
  });
  it('requires a real mail transport in production and credentials for Resend', () => {
    expect(() =>
      parseEnvironment({
        ...valid,
        NODE_ENV: 'production',
        APP_ORIGIN: 'https://sitepulse.example',
      }),
    ).toThrow('AUTH_MAIL_TRANSPORT');
    expect(() =>
      parseEnvironment({ ...valid, AUTH_MAIL_TRANSPORT: 'resend' }),
    ).toThrow('RESEND_API_KEY');
    expect(() =>
      parseWorkerEnvironment({ ...valid, NODE_ENV: 'production' }),
    ).toThrow('AUTH_MAIL_TRANSPORT');
    expect(() =>
      parseWorkerEnvironment({
        ...valid,
        NODE_ENV: 'production',
        AUTH_MAIL_TRANSPORT: 'resend',
        RESEND_API_KEY: 'test-provider-key-not-used',
      }),
    ).toThrow('HTTPS');
  });
  it('parses defaults', () =>
    expect(parseEnvironment(valid).API_PORT).toBe(4000));
  it('rejects missing secrets without printing values', () => {
    expect(() =>
      parseEnvironment({ ...valid, BETTER_AUTH_SECRET: 'sensitive' }),
    ).toThrow('BETTER_AUTH_SECRET');
    expect(() =>
      parseEnvironment({ ...valid, DATABASE_URL: 'not-a-url' }),
    ).toThrow('DATABASE_URL');
  });
  it('requires HTTPS in production and rejects placeholder secrets', () => {
    expect(() =>
      parseEnvironment({ ...valid, NODE_ENV: 'production' }),
    ).toThrow('HTTPS');
    expect(() =>
      parseEnvironment({
        ...valid,
        BETTER_AUTH_SECRET: 'replace-with-a-random-secret-of-48-characters',
      }),
    ).toThrow('BETTER_AUTH_SECRET');
  });
  it('rejects paths and unsupported database protocols', () => {
    expect(() =>
      parseEnvironment({ ...valid, APP_ORIGIN: 'http://localhost:3000/' }),
    ).toThrow('APP_ORIGIN');
    expect(() =>
      parseEnvironment({ ...valid, DATABASE_URL: 'https://localhost/db' }),
    ).toThrow('DATABASE_URL');
  });
  it('validates malformed web and public origins without revealing their values', () => {
    expect(() =>
      parseEnvironment({ ...valid, APP_ORIGIN: 'malformed-sensitive-origin' }),
    ).toThrow('APP_ORIGIN');
    expect(() =>
      parseWebEnvironment({
        API_INTERNAL_ORIGIN: 'malformed-sensitive-origin',
      }),
    ).toThrow('API_INTERNAL_ORIGIN');
    expect(parseWebEnvironment({}).API_INTERNAL_ORIGIN).toBe(
      'http://127.0.0.1:4000',
    );
  });
});
