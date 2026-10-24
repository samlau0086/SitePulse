#!/usr/bin/env bash
# Control-flow fault injection. All infrastructure commands are doubles in a disposable directory.
set -euo pipefail
workspace=$(cd "$(dirname "$0")/.." && pwd)
fixture=$(mktemp -d)
trap 'rm -rf -- "$fixture"' EXIT
mkdir -p "$fixture/bin"
export SITEPULSE_DEPLOY_BASE="$fixture" CALLS="$fixture/calls"
export PATH="$fixture/bin:$PATH"
# Shell fixtures are test data, not production deployment instructions.
cat > "$fixture/bin/docker" <<'STUB'
#!/usr/bin/env bash
set -eu
printf '%s\n' "port=$WEB_BIND_PORT $*" >> "$CALLS"
if [[ "$*" == *' build '* && "${FAIL_AT:-}" == build ]]; then exit 1; fi
if [[ "$*" == *' run '* && "$*" == *'parseEnvironment'* && "${FAIL_AT:-}" == config ]]; then exit 1; fi
if [[ "$*" == *' exec '* ]]; then
  if [[ "${FAIL_AT:-}" == backup ]]; then exit 1; fi
  printf 'test dump'
fi
if [[ "$*" == *' run --rm --no-deps sitepulse-migrate'* && "${FAIL_AT:-}" == migration ]]; then exit 1; fi
if [[ "$*" == *' up --no-build '* && "${FAIL_AT:-}" == startup ]]; then exit 1; fi
if [[ "$*" == *' ps -q '* ]]; then echo test-worker; fi
if [[ "$1" == inspect ]]; then
  if [[ "${FAIL_AT:-}" == worker ]]; then echo false; else echo true; fi
fi
STUB
cat > "$fixture/bin/age" <<'STUB'
#!/usr/bin/env bash
if [[ "${FAIL_AT:-}" == encryption ]]; then exit 1; fi
cat
STUB
cat > "$fixture/bin/curl" <<'STUB'
#!/usr/bin/env bash
printf 'curl %s\n' "$*" >> "$CALLS"
[[ "${FAIL_AT:-}" != https ]]
STUB
chmod +x "$fixture/bin/"*
release=0123456789012345678901234567890123456789-1-1
root="$fixture/sitepulse-staging"
mkdir -p "$root/shared" "$root/releases/$release"
printf 'POSTGRES_USER=sitepulse\nPOSTGRES_DB=sitepulse\nPOSTGRES_PASSWORD=test\n' > "$root/shared/.env"
printf 'age1testrecipient\n' > "$root/shared/backup-recipient.txt"
printf 'https://staging.example.invalid\n' > "$root/shared/public-origin.txt"

for failure in build config backup encryption migration startup https worker; do
  export FAIL_AT="$failure"
  : > "$CALLS"
  if bash "$workspace/scripts/deploy-vps.sh" staging "$release" > "$fixture/output" 2>&1; then
    echo "Expected failure: $failure" >&2; exit 1
  fi
  [[ ! -e "$root/current" && ! -e "$root/current-release.txt" ]]
  if [[ "$failure" == build || "$failure" == config ]]; then
    if grep -q ' stop ' "$CALLS"; then echo 'Preflight stopped the application' >&2; exit 1; fi
  fi
  if [[ "$failure" == backup || "$failure" == encryption ]]; then
    if grep -q 'run --rm --no-deps sitepulse-migrate' "$CALLS"; then echo 'Migration ran without backup' >&2; exit 1; fi
  fi
  if [[ "$failure" == migration ]]; then
    if grep -q 'up --no-build' "$CALLS"; then echo 'Application started after failed migration' >&2; exit 1; fi
  fi
  echo "Failure handling passed: $failure"
done
unset FAIL_AT
rm -f "$root/backups/$release.dump.age.partial"
bash "$workspace/scripts/deploy-vps.sh" staging "$release"
[[ $(readlink "$root/current") == "$root/releases/$release" ]]
[[ $(<"$root/current-release.txt") == "$release" && -s "$root/backups/$release.dump.age" ]]
[[ $(<"$root/current-web-bind-port.txt") == 3000 ]]
echo 'Deployment success recording passed'
# Exercise first-run config stdin through the real deployment entry point.
mkdir "$fixture/config-input"
cp "$root/shared/.env" "$root/shared/public-origin.txt" "$root/shared/backup-recipient.txt" "$fixture/config-input/"
tar -cf "$fixture/config.tar" -C "$fixture/config-input" .env public-origin.txt backup-recipient.txt
rm "$root/shared/.env"
bash "$workspace/scripts/deploy-vps.sh" staging "$release" 18080 --configure-from-stdin < "$fixture/config.tar" > "$fixture/output" 2>&1
[[ -s "$root/shared/.env" && $(stat -c '%a' "$root/shared/.env") == 600 ]]
echo 'Deployment initializes missing configuration from SSH stdin under the lock'
bash "$workspace/scripts/deploy-vps.sh" staging "$release" 18080 > "$fixture/output" 2>&1
[[ $(<"$root/current-web-bind-port.txt") == 18080 ]]
grep -q 'port=18080 compose' "$CALLS"
grep -q 'http://127.0.0.1:18080/api/v1/health' "$CALLS"
echo 'Custom application port passed through Compose, health check and release record'
for invalid_port in 0 65536 03000 '3000;echo injected'; do
  : > "$CALLS"
  if bash "$workspace/scripts/deploy-vps.sh" staging "$release" "$invalid_port" > "$fixture/output" 2>&1; then exit 1; fi
  [[ ! -s "$CALLS" ]]
  grep -q 'WEB_BIND_PORT must be' "$fixture/output"
done
echo 'Invalid application ports rejected before infrastructure changes'
if bash "$workspace/scripts/deploy-vps.sh" invalid "$release" >/dev/null 2>&1; then exit 1; fi
if bash "$workspace/scripts/deploy-vps.sh" staging '../escape' >/dev/null 2>&1; then exit 1; fi
echo 'Deployment argument validation passed'
