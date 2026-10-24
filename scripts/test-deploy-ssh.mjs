import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
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
];
for (const scenario of cases) {
  const directory = mkdtempSync(join(tmpdir(), 'sitepulse-ssh-test-'));
  try {
    const bin = join(directory, 'bin');
    const calls = join(directory, 'calls');
    mkdirSync(bin);
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
    ;;
  git) printf 'fixture-archive' ;;
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
    assert.equal(commands.includes('ssh'), scenario.ok);
    assert.equal(commands.includes('scp'), scenario.ok);
    assert.equal(result.stdout.includes('::warning::'), !scenario.configured);
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
