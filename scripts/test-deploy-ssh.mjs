import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Execute the actual workflow shell block with transport doubles; never contact a VPS.
const workflow = readFileSync('.github/workflows/deploy.yml', 'utf8');
const block = workflow.split('        run: |\n')[1];
assert.ok(block, 'Expected the deployment shell block');
const script = block.replace(/^ {10}/gm, '');
const hostKey = 'test-vps.invalid ssh-ed25519 fixture-host-key';
const cases = [
  {
    name: 'configured key skips discovery',
    configured: hostKey,
    scan: 'fail',
    ok: true,
  },
  {
    name: 'omitted key uses discovery',
    configured: '',
    scan: 'success',
    ok: true,
  },
  {
    name: 'missing directory is created idempotently and deployment continues',
    configured: hostKey,
    scan: 'fail',
    missingDirectory: true,
    ok: true,
  },
  {
    name: 'failed discovery blocks transport',
    configured: '',
    scan: 'fail',
    ok: false,
  },
  {
    name: 'empty discovery blocks transport',
    configured: '',
    scan: 'empty',
    ok: false,
  },
  ...[
    ['archive', 'source archive'],
    ['authentication', 'VPS setup and SSH authentication'],
    ['blocked-directory', 'VPS setup and SSH authentication'],
    ['fresh-root', 'VPS setup and SSH authentication'],
    ['missing-config', 'VPS setup and SSH authentication'],
    ['upload', 'source upload'],
    ['deploy', 'remote build, backup, migration and health verification'],
  ].map(([failure, phase]) => ({
    name: `${failure} failure names the stage`,
    configured: hostKey,
    scan: 'fail',
    failure,
    phase,
    ok: false,
  })),
  ...['0', '65536', '03000', '3000;echo injected'].map((port) => ({
    name: 'invalid application port blocks transport',
    configured: hostKey,
    scan: 'fail',
    port,
    ok: false,
  })),
];
for (const scenario of cases) {
  const directory = mkdtempSync(join(tmpdir(), 'sitepulse-ssh-test-'));
  try {
    const bin = join(directory, 'bin');
    const calls = join(directory, 'calls');
    mkdirSync(bin);
    const remote = join(directory, 'remote');
    for (const name of ['incoming', 'releases', 'shared', 'backups', 'logs']) {
      if (scenario.failure === 'fresh-root') continue;
      if (
        name !== 'incoming' ||
        (!scenario.missingDirectory && scenario.failure !== 'blocked-directory')
      )
        mkdirSync(join(remote, name), { recursive: true, mode: 0o750 });
    }
    if (scenario.failure === 'blocked-directory')
      writeFileSync(join(remote, 'incoming'), 'existing-file');
    for (const name of ['.env', 'backup-recipient.txt', 'public-origin.txt']) {
      if (
        scenario.failure !== 'fresh-root' &&
        (scenario.failure !== 'missing-config' || name !== '.env')
      )
        writeFileSync(join(remote, 'shared', name), 'fixture');
    }
    writeFileSync(calls, '');
    const stub = `#!/usr/bin/env bash
set -eu
command_name=$(basename "$0")
printf '%s\\n' "$command_name" >> "$TEST_CALLS"
case "$command_name" in
  ssh-keyscan)
    [[ " $* " == *' -p 2222 '* ]]
    case "$TEST_SCAN" in
      fail) exit 1 ;;
      empty) exit 0 ;;
      success) printf '%s\\n' "$TEST_HOST_KEY" ;;
    esac
    ;;
  ssh|scp)
    [[ " $* " == *' StrictHostKeyChecking=yes '* ]]
    [[ "$(<"$RUNNER_TEMP/sitepulse-known-hosts")" == "$TEST_HOST_KEY" ]]
    [[ "$(<"$RUNNER_TEMP/sitepulse-deploy-key")" == fixture-private-key ]]
    if [[ "$command_name" == scp ]]; then
      [[ "$TEST_FAILURE" != upload ]]
    elif [[ " $* " == *'set -eu; umask 077; for dir'* ]]; then
      [[ "$TEST_FAILURE" != authentication ]] || exit 255
      remote_command="\${!#}"
      remote_command="\${remote_command//"$TEST_ROOT"/"$TEST_REMOTE"}"
      bash -c "$remote_command"
      if [[ "$TEST_REPEAT_SETUP" == true ]]; then bash -c "$remote_command"; fi
    else
      [[ " $* " == *"'staging' '0000000000000000000000000000000000000000-1-1' '18080'"* ]]
      [[ "$TEST_FAILURE" != deploy ]]
    fi
    ;;
  git) [[ "$TEST_FAILURE" != archive ]] || exit 1; printf 'fixture-archive' ;;
esac
`;
    for (const command of ['ssh-keyscan', 'ssh', 'scp', 'git']) {
      writeFileSync(join(bin, command), stub, { mode: 0o700 });
    }
    const result = spawnSync('bash', ['-c', script], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        RUNNER_TEMP: directory,
        TEST_CALLS: calls,
        TEST_SCAN: scenario.scan,
        TEST_HOST_KEY: hostKey,
        TEST_FAILURE: scenario.failure ?? '',
        TEST_REPEAT_SETUP: String(Boolean(scenario.missingDirectory)),
        TEST_REMOTE: remote,
        TEST_ROOT: '/opt/sitepulse-staging',
        WEB_BIND_PORT: scenario.port ?? '18080',
        VPS_HOST: 'test-vps.invalid',
        VPS_PORT: '2222',
        VPS_USER: 'deploy',
        VPS_SSH_KEY: 'fixture-private-key',
        VPS_KNOWN_HOSTS: scenario.configured,
        DEPLOY_ENVIRONMENT: 'staging',
        GITHUB_SHA: '0'.repeat(40),
        GITHUB_RUN_ID: '1',
        GITHUB_RUN_ATTEMPT: '1',
      },
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status === 0, scenario.ok, scenario.name);
    const commands = readFileSync(calls, 'utf8').trim().split('\n');
    assert.equal(commands.includes('ssh-keyscan'), !scenario.configured);
    assert.equal(
      commands.includes('ssh'),
      scenario.ok ||
        Boolean(scenario.failure && scenario.failure !== 'archive'),
    );
    assert.equal(
      commands.includes('scp'),
      scenario.ok || ['upload', 'deploy'].includes(scenario.failure),
    );
    assert.equal(result.stdout.includes('::warning::'), !scenario.configured);
    if (scenario.phase)
      assert.ok(result.stderr.includes(`failed during ${scenario.phase}`));
    if (
      ['missing-config', 'blocked-directory', 'fresh-root'].includes(
        scenario.failure,
      )
    )
      assert.ok(result.stderr.includes('VPS setup incomplete:'));
    if (scenario.missingDirectory) {
      assert.equal(statSync(join(remote, 'incoming')).mode & 0o777, 0o700);
      assert.equal(statSync(join(remote, 'shared')).mode & 0o777, 0o750);
      assert.equal(
        readFileSync(join(remote, 'shared', '.env'), 'utf8'),
        'fixture',
      );
    }
    if (scenario.failure === 'fresh-root') {
      for (const name of [
        '',
        'incoming',
        'releases',
        'shared',
        'backups',
        'logs',
      ])
        assert.equal(statSync(join(remote, name)).mode & 0o777, 0o700);
      assert.throws(() => statSync(join(remote, 'shared', '.env')), {
        code: 'ENOENT',
      });
      assert.ok(
        result.stderr.includes('configuration missing, empty or not readable:'),
      );
    }
    if (scenario.port)
      assert.ok(result.stderr.includes('WEB_BIND_PORT must be'));
    assert.equal(result.stdout.includes('fixture-private-key'), false);
    assert.equal(result.stderr.includes('fixture-private-key'), false);
    for (const file of [
      'sitepulse-deploy-key',
      'sitepulse-known-hosts',
      'sitepulse-release.tar.gz',
    ]) {
      assert.throws(() => readFileSync(join(directory, file)), {
        code: 'ENOENT',
      });
    }
    console.info(`SSH deployment check passed: ${scenario.name}`);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
