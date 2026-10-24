#!/usr/bin/env bash
set -euo pipefail
workspace=$(cd "$(dirname "$0")/.." && pwd)
fixture=$(mktemp -d)
trap 'rm -rf -- "$fixture"' EXIT
mkdir "$fixture/shared" "$fixture/input"
printf "POSTGRES_USER='sitepulse'\nPOSTGRES_DB='sitepulse'\nPOSTGRES_PASSWORD='fixture-password'\nBETTER_AUTH_SECRET='fixture-auth-secret'\n" > "$fixture/input/.env"
printf 'https://staging.example.invalid\n' > "$fixture/input/public-origin.txt"
printf 'age1fixture\n' > "$fixture/input/backup-recipient.txt"
tar -cf "$fixture/payload.tar" -C "$fixture/input" .env public-origin.txt backup-recipient.txt
bash "$workspace/scripts/install-vps-config.sh" "$fixture/shared" < "$fixture/payload.tar" > "$fixture/output"
for name in .env public-origin.txt backup-recipient.txt; do
  cmp "$fixture/input/$name" "$fixture/shared/$name"
  [[ $(stat -c '%a' "$fixture/shared/$name") == 600 ]]
done
echo 'First-run automatic configuration installation and private file modes passed'
bash "$workspace/scripts/install-vps-config.sh" "$fixture/shared" < "$fixture/payload.tar" > "$fixture/output"
echo 'Repeated configuration installation passed'
# Legacy unquoted dotenv must compare equal; no eval or shell execution.
printf 'POSTGRES_USER=sitepulse\nPOSTGRES_DB=sitepulse\nPOSTGRES_PASSWORD=fixture-password\n' > "$fixture/shared/.env"
bash "$workspace/scripts/install-vps-config.sh" "$fixture/shared" < "$fixture/payload.tar" > "$fixture/output"
echo 'Legacy dotenv comparison passed'
for name in POSTGRES_USER POSTGRES_DB POSTGRES_PASSWORD; do
  cp "$fixture/shared/.env" "$fixture/prior.env"
  sed "s/^$name=.*/$name='changed'/" "$fixture/prior.env" > "$fixture/shared/.env"
  cp "$fixture/shared/.env" "$fixture/expected.env"
  if bash "$workspace/scripts/install-vps-config.sh" "$fixture/shared" < "$fixture/payload.tar" > "$fixture/output" 2>&1; then exit 1; fi
  cmp "$fixture/shared/.env" "$fixture/expected.env"
  grep -q 'explicit database rotation is required' "$fixture/output"
  if grep -q 'fixture-password' "$fixture/output"; then exit 1; fi
  cp "$fixture/prior.env" "$fixture/shared/.env"
done
echo 'Database identity/password changes blocked without overwriting existing configuration'
tar -cf "$fixture/bad.tar" -C "$fixture/input" public-origin.txt
if bash "$workspace/scripts/install-vps-config.sh" "$fixture/shared" < "$fixture/bad.tar" > "$fixture/output" 2>&1; then exit 1; fi
cmp "$fixture/prior.env" "$fixture/shared/.env"
[[ -z $(find "$fixture/shared" -name '.config-*' -print -quit) ]]
echo 'Unexpected archive rejected and temporary secrets cleaned up'
# Bootstrap must leave a host with existing tools unchanged.
mkdir "$fixture/bin"
for name in docker age curl flock; do
  printf '#!/bin/sh\nexit 0\n' > "$fixture/bin/$name"
  chmod +x "$fixture/bin/$name"
done
printf '#!/bin/sh\nexit 99\n' > "$fixture/bin/apt-get"
chmod +x "$fixture/bin/apt-get"
PATH="$fixture/bin:$PATH" bash "$workspace/scripts/bootstrap-vps.sh"
echo 'Bootstrap skips package installation when tools already exist'
# An isolated PATH simulates a root host missing age; apt is a recording double.
printf '#!/bin/sh\nprintf "0\\n"\n' > "$fixture/bin/id"
# Arguments and the log path expand when the recording double executes.
# shellcheck disable=SC2016
printf '#!/bin/sh\nprintf "%%s\\n" "$*" >> "$BOOTSTRAP_CALLS"\n' > "$fixture/bin/apt-get"
chmod +x "$fixture/bin/id" "$fixture/bin/apt-get"
rm "$fixture/bin/age"
export BOOTSTRAP_CALLS="$fixture/bootstrap-calls"
PATH="$fixture/bin" "$BASH" "$workspace/scripts/bootstrap-vps.sh"
grep -q '^update -qq$' "$BOOTSTRAP_CALLS"
grep -q '^install -y --no-install-recommends age$' "$BOOTSTRAP_CALLS"
echo 'Root bootstrap automatically installs only the missing utility'
