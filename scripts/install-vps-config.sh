#!/usr/bin/env bash
# Called under deploy.lock; stdin is a tar stream sent through authenticated SSH.
set -euo pipefail
umask 077
shared=$1
temporary=$(mktemp -d "$shared/.config-XXXXXXXX")
trap 'rm -rf -- "$temporary"' EXIT
cat > "$temporary/payload.tar"
members=$(tar -tf "$temporary/payload.tar")
[[ "$members" == $'.env\npublic-origin.txt\nbackup-recipient.txt' ]] || { echo 'Unexpected configuration archive members' >&2; exit 1; }
tar --extract --file "$temporary/payload.tar" --directory "$temporary" --no-same-owner --no-same-permissions
for name in .env public-origin.txt backup-recipient.txt; do
  [[ -f "$temporary/$name" && ! -L "$temporary/$name" && -s "$temporary/$name" ]] || { echo 'Invalid configuration file' >&2; exit 1; }
  chmod 600 "$temporary/$name"
done
# Never source dotenv: it is data, not shell code. Refuse implicit DB rotation.
dotenv_value() {
  local line value
  line=$(grep -m1 "^$2=" "$1") || return 1
  value=${line#*=}
  value=${value%$'\r'}
  if [[ "$value" == \'*\' || "$value" == \"*\" ]]; then value=${value:1:${#value}-2}; fi
  printf '%s' "$value"
}
if [[ -s "$shared/.env" ]]; then
  for name in POSTGRES_USER POSTGRES_DB POSTGRES_PASSWORD; do
    old=$(dotenv_value "$shared/.env" "$name") || { echo "Existing $name cannot be compared safely; configuration unchanged" >&2; exit 1; }
    new=$(dotenv_value "$temporary/.env" "$name")
    [[ "$old" == "$new" ]] || { echo "$name differs from the existing database configuration; explicit database rotation is required. Configuration unchanged." >&2; exit 1; }
  done
fi
for name in .env public-origin.txt backup-recipient.txt; do
  mv -f -- "$temporary/$name" "$shared/$name"
done
echo 'GitHub deployment configuration installed with mode 600.'
