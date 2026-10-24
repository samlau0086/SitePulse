#!/usr/bin/env bash
# Install only missing backup/health/locking utilities on Debian/Ubuntu root hosts.
set -euo pipefail
command -v docker >/dev/null || { echo 'Docker Engine with Compose v2 must be available on the VPS' >&2; exit 1; }
docker compose version >/dev/null
packages=()
command -v age >/dev/null || packages+=(age)
command -v curl >/dev/null || packages+=(curl)
command -v flock >/dev/null || packages+=(util-linux)
if (( ${#packages[@]} )); then
  if [[ $(id -u) != 0 ]] || ! command -v apt-get >/dev/null; then
    echo 'Automatic helper installation requires root on Debian/Ubuntu (age, curl, util-linux)' >&2; exit 1
  fi
  echo 'Installing missing deployment utilities.'
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "${packages[@]}"
fi
