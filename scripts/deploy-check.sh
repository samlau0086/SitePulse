#!/usr/bin/env sh
set -eu
pnpm check
pnpm db:check
pnpm test:integration
pnpm build
pnpm audit --prod --audit-level high
pnpm compose:check
