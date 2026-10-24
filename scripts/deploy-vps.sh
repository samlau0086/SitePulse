#!/usr/bin/env bash
# Invoked only from the trusted main-branch workflow. Never enable shell tracing.
set -Eeuo pipefail
umask 077

environment=${1:-}
release=${2:-}
web_bind_port=${3:-${WEB_BIND_PORT:-}}
[[ "$environment" =~ ^(staging|production)$ ]] || { echo 'Invalid environment' >&2; exit 1; }
[[ "$release" =~ ^[a-f0-9]{40}-[0-9]+-[0-9]+$ ]] || { echo 'Invalid release' >&2; exit 1; }
if [[ -z "$web_bind_port" ]]; then
  if [[ "$environment" == production ]]; then web_bind_port=3001; else web_bind_port=3000; fi
fi
if [[ ! "$web_bind_port" =~ ^[1-9][0-9]{0,4}$ ]] || (( web_bind_port > 65535 )); then
  echo 'WEB_BIND_PORT must be an application host port from 1 to 65535' >&2; exit 1
fi
root="${SITEPULSE_DEPLOY_BASE:-/opt}/sitepulse-$environment"
candidate="$root/releases/$release"
[[ -d "$candidate" && -f "$root/shared/.env" ]] || { echo 'VPS setup is incomplete' >&2; exit 1; }
for tool in docker age flock curl; do command -v "$tool" >/dev/null || { echo "Missing tool: $tool" >&2; exit 1; }; done
exec 9>"$root/deploy.lock"
flock -n 9 || { echo 'Another deployment is running' >&2; exit 1; }
[[ -s "$root/shared/backup-recipient.txt" && -s "$root/shared/public-origin.txt" ]] || { echo 'Backup recipient/public origin missing' >&2; exit 1; }
origin=$(<"$root/shared/public-origin.txt")
[[ "$origin" =~ ^https://[a-zA-Z0-9][a-zA-Z0-9.-]*$ ]] || { echo 'Expected an HTTPS origin without path or trailing slash' >&2; exit 1; }
recipient=$(<"$root/shared/backup-recipient.txt")
[[ "$recipient" =~ ^age1[0-9a-z]+$ ]] || { echo 'Expected an age public recipient' >&2; exit 1; }
mkdir -p "$root/backups" "$root/logs"
log="$root/logs/$release.log"
backup="$root/backups/$release.dump.age"
compose=(docker compose --project-name "sitepulse-$environment" --env-file "$root/shared/.env" -f "$candidate/docker-compose.yml")
# Stable project name preserves the database volume; release-specific tags preserve old images.
export COMPOSE_PROJECT_NAME="sitepulse-$environment" SITEPULSE_RELEASE="$release"
export WEB_BIND_PORT="$web_bind_port"
phase=preflight
on_error() {
  echo "Deployment failed during $phase. Protected VPS log: $log" >&2
  if [[ "$phase" == backup || "$phase" == migration || "$phase" == startup || "$phase" == verification ]]; then
    # Do not serve an unverified release or restart an older app against an unknown schema.
    "${compose[@]}" stop sitepulse-web sitepulse-api sitepulse-worker >>"$log" 2>&1 || true
    echo 'Application remains stopped. Review migration state and use the documented recovery procedure.' >&2
  fi
}
trap on_error ERR
"${compose[@]}" config --quiet >>"$log" 2>&1
echo 'Building candidate images; current application stays running.'
# Keep each command's diagnostics scoped so trap messages remain visible to the operator.
# shellcheck disable=SC2129
"${compose[@]}" build sitepulse-api sitepulse-worker sitepulse-web >>"$log" 2>&1
# Migrate uses the same API image but is explicitly tagged in Compose.
"${compose[@]}" build sitepulse-migrate >>"$log" 2>&1
"${compose[@]}" run --rm --no-deps --entrypoint node sitepulse-api --import tsx -e \
  "import {parseEnvironment} from './packages/config/src/index.ts'; const env=parseEnvironment(process.env); if(env.APP_ORIGIN!==process.argv[1])process.exit(1)" "$origin" >>"$log" 2>&1
"${compose[@]}" run --rm --no-deps --entrypoint node sitepulse-worker --import tsx -e \
  "import {parseWorkerEnvironment} from './packages/config/src/index.ts'; parseWorkerEnvironment(process.env)" >>"$log" 2>&1
phase=backup
echo 'Pausing writes and creating an encrypted pre-migration backup.'
"${compose[@]}" stop sitepulse-web sitepulse-api sitepulse-worker >>"$log" 2>&1
"${compose[@]}" up -d --wait --wait-timeout 120 sitepulse-db >>"$log" 2>&1
# pipefail aborts on pg_dump failure; plaintext is never stored on disk.
# Variables must expand inside the database container, not on the VPS host.
# shellcheck disable=SC2016
"${compose[@]}" exec -T sitepulse-db sh -c 'pg_dump --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --format=custom' \
  2>>"$log" | age -r "$recipient" > "$backup.partial"
[[ -s "$backup.partial" ]]
mv "$backup.partial" "$backup"
phase=migration
echo 'Applying forward-only migrations.'
"${compose[@]}" run --rm --no-deps sitepulse-migrate >>"$log" 2>&1
phase=startup
"${compose[@]}" up --no-build --no-deps -d --wait --wait-timeout 180 sitepulse-api sitepulse-worker sitepulse-web >>"$log" 2>&1
phase=verification
curl --fail --silent --show-error --max-time 30 "http://127.0.0.1:$WEB_BIND_PORT/api/v1/health" -o /dev/null
curl --fail --silent --show-error --retry 5 --retry-all-errors --retry-delay 5 --max-time 30 "$origin/api/v1/health" -o /dev/null
worker_id=$("${compose[@]}" ps -q sitepulse-worker)
[[ -n "$worker_id" && $(docker inspect --format '{{.State.Running}}' "$worker_id") == true ]]
if [[ -L "$root/current" ]]; then readlink "$root/current" > "$root/previous-release.txt"; fi
ln -s "$candidate" "$root/current.next-$release"
mv -Tf "$root/current.next-$release" "$root/current"
printf '%s\n' "$release" > "$root/current-release.txt"
printf '%s\n' "$WEB_BIND_PORT" > "$root/current-web-bind-port.txt"
phase=complete
echo "Deployment verified: $release. Encrypted backup retained on VPS; verify off-host copy and restore separately."
