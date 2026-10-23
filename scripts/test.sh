#!/usr/bin/env sh
set -eu
pnpm check
pnpm db:check
pnpm test:integration
pnpm build
