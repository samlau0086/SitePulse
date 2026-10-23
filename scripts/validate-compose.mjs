import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';

function configuration(files) {
  const result = spawnSync(
    'docker',
    [
      'compose',
      ...files.flatMap((file) => ['-f', file]),
      'config',
      '--format',
      'json',
    ],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        APP_ORIGIN: 'https://sitepulse.example.invalid',
        POSTGRES_PASSWORD: randomBytes(32).toString('base64url'),
        BETTER_AUTH_SECRET: randomBytes(48).toString('base64url'),
      },
    },
  );
  if (result.error || result.status !== 0)
    throw new Error(
      'Compose validation failed. Install Docker Compose v2 and check configuration.',
    );
  return JSON.parse(result.stdout);
}

const production = configuration(['docker-compose.yml']);
for (const [name, service] of Object.entries(production.services)) {
  if (name !== 'sitepulse-web')
    assert.equal(
      service.ports,
      undefined,
      `${name} must not publish a production port`,
    );
}
assert.deepEqual(production.services['sitepulse-worker'].networks, {
  database: null,
});
assert.equal(
  production.services['sitepulse-db'].ports,
  undefined,
  'Production database must not publish ports',
);
assert.equal(
  production.services['sitepulse-api'].ports,
  undefined,
  'Production API must remain private',
);
assert.equal(
  production.services['sitepulse-api'].environment.NODE_ENV,
  'production',
);
assert.equal(
  production.services['sitepulse-web'].ports[0].host_ip,
  '127.0.0.1',
);
assert.equal(production.networks.database.internal, true);
assert.equal(
  production.services['sitepulse-api'].depends_on['sitepulse-migrate']
    .condition,
  'service_completed_successfully',
);
const development = configuration([
  'docker-compose.yml',
  'docker-compose.dev.yml',
]);
assert.equal(
  development.services['sitepulse-db'].ports[0].host_ip,
  '127.0.0.1',
);
assert.equal(
  development.services['sitepulse-api'].environment.NODE_ENV,
  'development',
);
assert.equal(
  development.services['sitepulse-migrate'].environment.NODE_ENV,
  'development',
);
const testing = configuration(['docker-compose.test.yml']);
assert.equal(testing.services.database.ports[0].host_ip, '127.0.0.1');
console.info(
  'Production, development, and test Compose configurations passed; production database and API remain private.',
);
