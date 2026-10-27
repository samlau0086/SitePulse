# Plans and manual entitlements

This milestone enforces site counts only. Payments, renewals and premium feature gates remain deferred. Existing monitoring and alerts retain their behavior.

| Plan code     | Default sites |
| ------------- | ------------: |
| `free`        |             2 |
| `pro`         |            10 |
| `agency`      |            30 |
| `agency_plus` |           100 |

Defaults are centralized in `packages/config/src/index.ts`. Each organization can have a nullable `site_limit_override` (0–1000). An explicit override takes precedence; null uses the plan default. Migration 0006 leaves existing organizations on their stored plan and never removes sites, even if they exceed its limit.

## Platform administration

`/app/admin` provides a searchable directory (25 workspaces per page), plan/usage displays and an inline entitlement editor. Configure the server-only `PLATFORM_ADMIN_USER_IDS` comma-separated UUID allowlist and verify the account email; see README for local and GitHub Environment setup. Empty means deny all. No migration is needed. Organization owner/admin roles do not confer platform permission. Every admin API authenticates the current Better Auth session independently; tenant APIs still require membership.

Choose a plan, enter a custom allowance (0–1000) or leave blank to use its default, and supply a reason (1–300 characters). Preview shows current/resulting usage and blocked creation/restoration; existing monitoring continues after downgrade. Editing clears the preview. Confirm submits the expected prior plan, override, usage and update timestamp. The server locks the organization and rejects changed snapshots with 409 `PREVIEW_EXPIRED`; preview again. This is concurrency protection, not a separate permission token. Every write rechecks platform authority.

Saves atomically record `organization.entitlements.updated` with authenticated `actorUserId`, server request ID, reason and before/after values. Clients cannot choose actors/operators. Existing workspace audit visibility remains owner/admin-only. Failed or preview-only requests do not write allocation events. Undo with a new explicit change and reason; audit events remain. Allowlist changes require API restart/redeployment. No administrator assignment or payment UI is included.

## Counting and concurrency

All non-deleted sites count, including pending, active, degraded and disconnected sites. Disconnecting or rotating credentials does not free a slot. Soft deletion frees it. Downgrade preserves sites, credentials, history, jobs and alerts, but blocks creation/restoration until usage is below the effective limit.

Creation, restoration and operator entitlement updates acquire the same PostgreSQL organization row lock in a transaction. The count runs after acquiring the lock, preventing concurrent requests from consuming the same last slot. `FOR NO KEY UPDATE` permits foreign-key checks while serializing quota decisions. Future write paths that increase usage must use this lock. Privileged direct SQL can bypass application quotas.

`GET /api/v1/organizations/:organizationId/usage` requires membership and returns `{ usage: { planCode, siteLimit, siteLimitOverride, sitesUsed, sitesRemaining, canAddSite, overLimit } }`. Creation/restoration return HTTP 409 `SITE_LIMIT_REACHED` at capacity. Organization/site mutation requests reject plan/override fields.

`POST /api/v1/sites/:siteId/restore` accepts `{}` and requires verified owner/admin access and the trusted Origin. It restores a deleted site as disconnected, revoking old credentials/challenges and clearing monitoring jobs. Fresh pairing is required. A conflicting non-deleted URL returns 409. Restoration is API-only; there is no deleted-site directory or restore button yet.

## Operator command

The command requires trusted operator access to the database. It is not a tenant API or a self-service upgrade. The database credential is the authority; `--operator` is a human-readable audit label, not user impersonation. Restrict shell/database access. Do not put credentials or customer data in labels/reasons.

Apply migration 0006 through normal deployment first. In host development, root `.env` supplies validated `DATABASE_URL`:

```sh
pnpm entitlements:set --organization <organization-uuid> --plan pro --site-limit default --operator ops --reason "Pilot allocation"
pnpm entitlements:set --organization <organization-uuid> --plan pro --site-limit 15 --operator ops --reason "Approved custom allowance"
pnpm entitlements:set --organization <organization-uuid> --plan free --site-limit default --operator ops --reason "Pilot ended"
```

All flags are required. `--site-limit default` clears the override, including on a plan change. `0` blocks additional sites. Output contains only the organization ID and resulting usage. Invalid input, missing organizations and database/migration failures return nonzero without printing connection strings or raw database errors.

The organization UUID appears in its workspace URL (`/app/organizations/<uuid>`). Workspaces and Add a site display plan usage. The disabled add button is advisory: the API rechecks quota, and a concurrent allocation can produce a server error. Refresh after an operator adjustment.

For an explicitly authorized deployed change, run from the Compose release directory using the API container's environment:

```sh
docker compose exec -T sitepulse-api node --import tsx apps/api/src/entitlements-cli.ts --organization <organization-uuid> --plan pro --site-limit default --operator ops --reason "Approved pilot allocation"
```

Use the same Compose file/project options as deployment. PostgreSQL stays private. Production entitlement changes need explicit authorization; migrations also require a verified backup. This milestone does not execute either on your VPS.

Each change atomically records `organization.entitlements.updated`, with operator, reason, old/new plan, override, effective limit and usage. Operator events have no impersonated `actorUserId`. The audit API remains owner/admin-only. Undo allocations with another explicit command using the previous values; prior audit events remain.

## Verification

Run `pnpm check`, `pnpm db:check`, `pnpm build`, and `pnpm compose:check`. Start `pnpm test:db:up`, set the dedicated disposable `TEST_DATABASE_URL` per README, run `pnpm test:integration`, then `pnpm test:db:down`.

Tests cover plan boundaries, zero/custom/reset overrides, concurrency, safe restoration, duplicate URLs, deletion, downgrade continuity, membership/Origin checks, forged fields, audit metadata and the real operator CLI. No payment provider or real email is used.
