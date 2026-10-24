import { describe, expect, it } from 'vitest';
import { prepareDeploymentConfiguration } from './deployment';

const valid = {
  APP_ORIGIN: 'https://staging.sitepulse.test',
  POSTGRES_PASSWORD: 'a'.repeat(48),
  BETTER_AUTH_SECRET: 'b'.repeat(48),
  AUTH_MAIL_FROM: 'auth@sitepulse.test',
  RESEND_API_KEY: 're_fixture-key-for-tests',
  BACKUP_AGE_RECIPIENT: `age1${'q'.repeat(58)}`,
};
describe('GitHub deployment configuration', () => {
  it('preserves validated monitor settings in the private deployment config', () => {
    const config = prepareDeploymentConfiguration({
      ...valid,
      MONITORING_ENABLED: 'false',
      MONITOR_INTERVAL_SECONDS: '600',
      SSL_INTERVAL_SECONDS: '7200',
    })['.env'];
    expect(config).toContain("MONITORING_ENABLED='false'\n");
    expect(config).toContain("MONITOR_INTERVAL_SECONDS='600'\n");
    expect(config).toContain("SSL_INTERVAL_SECONDS='7200'\n");
    expect(() =>
      prepareDeploymentConfiguration({
        ...valid,
        MONITOR_INTERVAL_SECONDS: '1',
      }),
    ).toThrow('Invalid worker');
  });
  it('produces production dotenv and matching backup/origin files', () => {
    const files = prepareDeploymentConfiguration(valid);
    expect(files['.env']).toContain("NODE_ENV='production'\n");
    expect(files['.env']).toContain("POSTGRES_USER='sitepulse'\n");
    expect(files['.env']).toContain("AUTH_MAIL_TRANSPORT='resend'\n");
    expect(files['public-origin.txt']).toBe(`${valid.APP_ORIGIN}\n`);
    expect(files['backup-recipient.txt']).toBe(
      `${valid.BACKUP_AGE_RECIPIENT}\n`,
    );
  });
  it('does not accept missing or placeholder secrets', () => {
    for (const name of [
      'POSTGRES_PASSWORD',
      'BETTER_AUTH_SECRET',
      'RESEND_API_KEY',
    ]) {
      expect(() =>
        prepareDeploymentConfiguration({ ...valid, [name]: '' }),
      ).toThrow(name);
    }
    expect(() =>
      prepareDeploymentConfiguration({
        ...valid,
        BETTER_AUTH_SECRET: 'replace-with-a-secret-of-48-characters',
      }),
    ).toThrow('BETTER_AUTH_SECRET');
  });
  it('blocks dotenv injection, unsafe database URLs and invalid production inputs', () => {
    for (const [name, value] of [
      ['POSTGRES_PASSWORD', 'unsafe@password'],
      ['POSTGRES_DB', 'db;injection'],
      ['BETTER_AUTH_SECRET', `${'a'.repeat(48)}\nINJECTED=true`],
      ['BETTER_AUTH_SECRET', `${'a'.repeat(48)}'`],
      ['RESEND_API_KEY', "key'with-quotes-and-more"],
      ['APP_ORIGIN', 'http://staging.sitepulse.test'],
      ['APP_ORIGIN', 'https://staging.sitepulse.test/path'],
      ['AUTH_MAIL_FROM', 'invalid-email'],
      ['BACKUP_AGE_RECIPIENT', 'AGE-SECRET-KEY-private'],
      ['WORKER_POLL_SECONDS', '1'],
    ]) {
      expect(() =>
        prepareDeploymentConfiguration({ ...valid, [name!]: value! }),
      ).toThrow();
    }
  });
  it('keeps interpolation syntax literal and error messages free of secret values', () => {
    const secret = `a${'$'}{SPECIAL}${'b'.repeat(48)}`;
    expect(
      prepareDeploymentConfiguration({ ...valid, BETTER_AUTH_SECRET: secret })[
        '.env'
      ],
    ).toContain(`BETTER_AUTH_SECRET='${secret}'`);
    try {
      prepareDeploymentConfiguration({
        ...valid,
        POSTGRES_PASSWORD: 'sensitive@value',
      });
      expect.fail('Expected validation failure');
    } catch (error) {
      expect(String(error)).not.toContain('sensitive@value');
    }
  });
});
