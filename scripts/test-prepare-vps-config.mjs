import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Exercise the actual runner CLI and Compose parser without contacting a VPS.
const directory = mkdtempSync(join(tmpdir(), 'sitepulse-config-test-'));
const output = join(directory, 'config');
const env = {
  ...process.env,
  APP_ORIGIN: 'https://staging.example.invalid',
  POSTGRES_USER: 'sitepulse',
  POSTGRES_DB: 'sitepulse',
  POSTGRES_PASSWORD: 'a'.repeat(48),
  BETTER_AUTH_SECRET: `fixture-${'b'.repeat(48)}${'$'}{LITERAL}`,
  AUTH_MAIL_FROM: 'auth@example.invalid',
  RESEND_API_KEY: 're_fixture-test-key',
  BACKUP_AGE_RECIPIENT: `age1${'q'.repeat(58)}`,
};
try {
  const prepared = spawnSync(
    process.execPath,
    ['--import', 'tsx', 'scripts/prepare-vps-config.mjs', output],
    { env, encoding: 'utf8' },
  );
  assert.equal(prepared.status, 0, 'Actual configuration CLI must succeed');
  assert.ok(!prepared.stdout.includes(env.BETTER_AUTH_SECRET));
  const compose = spawnSync(
    'docker',
    [
      'compose',
      '--env-file',
      join(output, '.env'),
      '-f',
      'docker-compose.yml',
      'config',
      '--format',
      'json',
    ],
    { env: { ...process.env, WEB_BIND_PORT: '18080' }, encoding: 'utf8' },
  );
  assert.equal(
    compose.status,
    0,
    'Generated dotenv must be valid Compose input',
  );
  const config = JSON.parse(compose.stdout);
  // Canonical Compose output escapes dollar signs for reuse as Compose input.
  assert.equal(
    config.services['sitepulse-api'].environment.BETTER_AUTH_SECRET.replaceAll(
      '$$',
      '$',
    ),
    env.BETTER_AUTH_SECRET,
  );
  assert.equal(
    config.services['sitepulse-api'].environment.DATABASE_URL,
    `postgresql://sitepulse:${env.POSTGRES_PASSWORD}@sitepulse-db:5432/sitepulse`,
  );
  assert.equal(config.services['sitepulse-web'].ports[0].published, '18080');
  assert.equal(config.services['sitepulse-db'].ports, undefined);
  const runtimeFile = join(directory, 'compose.json');
  writeFileSync(
    runtimeFile,
    JSON.stringify({
      name: 'sitepulse-config-parser-test',
      services: {
        'config-test': {
          image: 'node:22-alpine',
          network_mode: 'none',
          environment: { BETTER_AUTH_SECRET: '${BETTER_AUTH_SECRET}' },
          command: [
            'node',
            '-e',
            "process.exit(process.env.BETTER_AUTH_SECRET === Buffer.from(process.argv[1], 'base64').toString() ? 0 : 1)",
            Buffer.from(env.BETTER_AUTH_SECRET).toString('base64'),
          ],
        },
      },
    }),
  );
  const runtime = spawnSync(
    'docker',
    [
      'compose',
      '--env-file',
      join(output, '.env'),
      '-f',
      runtimeFile,
      'run',
      '--rm',
      '--no-deps',
      'config-test',
    ],
    { encoding: 'utf8' },
  );
  assert.equal(
    runtime.status,
    0,
    'The Docker process must receive the exact literal secret',
  );
  const invalid = spawnSync(
    process.execPath,
    [
      '--import',
      'tsx',
      'scripts/prepare-vps-config.mjs',
      join(directory, 'invalid'),
    ],
    { env: { ...env, POSTGRES_PASSWORD: '' }, encoding: 'utf8' },
  );
  assert.equal(invalid.status, 1);
  assert.ok(invalid.stderr.includes('POSTGRES_PASSWORD'));
  assert.equal(existsSync(join(directory, 'invalid')), false);
  console.info(
    'Actual configuration CLI, literal Compose parsing, private database and invalid-input cleanup passed.',
  );
} finally {
  rmSync(directory, { recursive: true, force: true });
}
