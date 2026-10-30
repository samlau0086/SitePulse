# SitePulse API

## Page performance

`GET /api/v1/sites/:siteId/performance` returns `{ performance }` with feature/connection availability, manual-refresh eligibility/cooldown, mobile/desktop latest successful reports and the latest 30 attempts within 30 days. A live session and server-checked tenant membership are required; nonmembers/unknown/deleted sites return 404. Reports contain selected Lighthouse lab metrics, not real-user Core Web Vitals.

`POST /api/v1/sites/:siteId/performance/refresh` accepts only `{}` and returns 202 `{ queued: true }`. Requires a trusted Origin and verified owner/admin membership. Both devices queue atomically and audit `performance.refresh_requested`; a queued/running job or 15-minute cooldown returns 409 `PERFORMANCE_BUSY`. Disabled configuration returns 409 `PERFORMANCE_DISABLED`; disconnected/revoked sites return 409 `SITE_NOT_CONNECTED`. The browser cannot choose URLs, API keys or strategies. See [performance operations](PERFORMANCE.md).

## Personal preferences

`GET /api/v1/auth/session` includes `user.timeZone` (default `UTC`). `PATCH /api/v1/users/me/preferences` accepts strict `{ "timeZone": "America/New_York" }` and returns `{ preferences: { timeZone } }`. A live Better Auth session and trusted mutation Origin are required; no organization membership or verified email is needed to change one's own display preference. The target user always comes from the session. Invalid/unsupported named zones, numeric offsets and additional fields (including user/organization IDs) return 400. Anonymous requests return 401, untrusted Origin returns 403. Values must be recognized named IANA zones (including UTC) on the server. This does not change tenant access, timestamp serialization, worker schedules or notification delivery.

Slack and Telegram use the same server membership, verified owner/admin, trusted mutation Origin, shared endpoint limit, cooldown, opt-in and audit rules as email/Bark:

| Route (under `/api/v1`)                                               | Body                          |
| --------------------------------------------------------------------- | ----------------------------- |
| `POST /organizations/:organizationId/notification-endpoints/slack`    | `{ label, webhookUrl }`       |
| `POST /organizations/:organizationId/notification-endpoints/telegram` | `{ label, botToken, chatId }` |

Chat credentials are encrypted using the validated `NOTIFICATION_ENCRYPTION_KEY`, never returned by reads, and cleared on deletion. Slack accepts only the exact official Incoming Webhook HTTPS host/path; Telegram requires a validated token and numeric chat ID and uses a fixed Bot API host. Generic resend/test/enable/delete routes apply. Missing encryption configuration returns 503. Provider failure returns sanitized 502 `CHANNEL_DELIVERY_FAILED`; the endpoint remains saved for retry. A public single-use verification proves destination access only, never account membership.

## Platform administration

Requires a live verified Better Auth session whose UUID is in the API's `PLATFORM_ADMIN_USER_IDS` allowlist. Missing session returns 401; ordinary organization owner/admin or unverified users receive 403. Mutations require trusted Origin. Tenant APIs still require membership.

- `GET /api/v1/admin/workspaces?q=<name|slug|uuid>&page=1`: literal case-insensitive substring search, q ≤100 characters, page 1–99999, 25 records/page. Returns `{ workspaces: [{ id, name, slug, usage }], hasMore }`.
- `POST /api/v1/admin/workspaces/:organizationId/entitlements/preview`: strict body `{ planCode, siteLimitOverride, reason }`; returns `{ before, after, expected }`. Plan: free/pro/agency/agency_plus; override: null (plan default) or integer 0–1000; trimmed reason: 1–300 characters. No write/audit event.
- `PATCH /api/v1/admin/workspaces/:organizationId/entitlements`: same fields plus `expected` from preview (`planCode`, `siteLimitOverride`, `sitesUsed`, `updatedAt`). Returns `{ usage }`, atomically audits authenticated actor/reason/before-after. Changed snapshots return 409 `PREVIEW_EXPIRED`; missing workspace 404; invalid/extra fields 400. Client-supplied actor/operator fields are rejected.

## Plan usage and restoration

`GET /organizations/:organizationId/usage` returns member-only `{ usage: { planCode, siteLimit, siteLimitOverride, sitesUsed, sitesRemaining, canAddSite, overLimit } }`. All non-deleted sites count, including pending/disconnected sites. Creation and restoration return 409 `SITE_LIMIT_REACHED` at capacity. Client-supplied plan/override fields are rejected.

`POST /sites/:siteId/restore` with `{}` and the trusted Origin requires verified owner/admin membership. It restores a deleted site as disconnected under quota. Old credentials remain revoked; fresh pairing is required. Duplicate active URLs return 409; cross-tenant requests return 404. There is no tenant entitlement mutation API. See [ENTITLEMENTS.md](ENTITLEMENTS.md).

Authentication lifecycle routes (all POST, strict JSON, trusted Origin, 5 requests/minute per route/IP):

| Route                   | Body                     | Result                                                            |
| ----------------------- | ------------------------ | ----------------------------------------------------------------- |
| `/auth/password/forgot` | `{ email }`              | Generic 200; eligible users receive a reset link                  |
| `/auth/password/reset`  | `{ token, newPassword }` | 200 and revoke sessions; 400 for invalid/expired/consumed token   |
| `/auth/email/resend`    | `{ email }`              | Generic 200, including unknown or verified email                  |
| `/auth/email/verify`    | `{ token }`              | 200 after explicit confirmation; invalid/expired link returns 400 |

Only these adapters are mounted; raw Better Auth callback routes stay private. The session response includes `emailVerified`. Reset tokens expire in 30 minutes, verification tokens in one hour. No callback URL or user ID is accepted from clients.

## Notification settings and recipients

Tenant notification reads require organization membership. Mutations require a verified owner/admin session and trusted Origin; platform administrator status does not bypass this tenant check. Foreign organizations and endpoint IDs return 404. Bodies are strict and never accept actor, verification or tenant state from the client.

| Method / path                                                                   | Body                    | Access/result                                                                              |
| ------------------------------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------ |
| `GET /organizations/:organizationId/notification-endpoints`                     | —                       | Member; sanitized settings, verified member addresses, recipients and `canManage`          |
| `PATCH /organizations/:organizationId/notification-settings`                    | `{ includeMembers }`    | Verified owner/admin; enable or disable automatic verified-member delivery                 |
| `POST /organizations/:organizationId/notification-endpoints`                    | `{ destination }`       | Verified owner/admin; save email recipient and send verification                           |
| `POST /organizations/:organizationId/notification-endpoints/bark`               | `{ label, deviceKey }`  | Verified owner/admin; encrypt Bark key and send an opt-in push; shared 20-recipient limit  |
| `PATCH /organizations/:organizationId/notification-endpoints/:endpointId`       | `{ enabled }`           | Verified owner/admin; enable or disable future and queued delivery                         |
| `DELETE /organizations/:organizationId/notification-endpoints/:endpointId`      | `{}`                    | Verified owner/admin; soft-delete recipient, invalidate proof and suppress queued delivery |
| `POST /organizations/:organizationId/notification-endpoints/:endpointId/resend` | `{}`                    | Verified owner/admin; rotate the one-hour proof and resend through the endpoint channel    |
| `POST /organizations/:organizationId/notification-endpoints/:endpointId/test`   | `{}`                    | Verified owner/admin; send through the channel only when verified and enabled              |
| `POST /notification-endpoints/verify`                                           | `{ endpointId, token }` | Public possession proof; single use, grants no session or membership                       |

Managed addresses override automatic member delivery for the same normalized email, including pending, disabled and deleted records; this prevents an address from silently falling back to member delivery. Verification/test sends have a persisted 60-second per-recipient cooldown and a shared ten-per-hour workspace allowance. Provider failures consume the allowance and never expose provider response data. Mutations and proof confirmation are audited without email addresses or token material. See [NOTIFICATIONS.md](NOTIFICATIONS.md).

Base path: `/api/v1`. Requests and responses use JSON. OpenAPI is generated from Fastify route metadata and request schemas at `/api/v1/docs/json`; a documentation entry page is at `/api/v1/docs/`.

Every state-changing request requires `Origin` exactly equal to `APP_ORIGIN`, including command-line clients. Browser sessions use HttpOnly, SameSite=Lax cookies and Secure cookies in production. Cookies are host-only. Use browser credentials or a cookie jar; never copy session tokens into local storage. JSON request bodies are capped at 16 KiB unless an endpoint documents a narrower or larger bound. Connector inventory is capped at 512 KiB and attachment ZIP uploads at 8 MiB. Unknown properties are rejected rather than silently stripped.

| Method / path                                   | Body                                                                                    | Access                                              |
| ----------------------------------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `GET /health`                                   | —                                                                                       | Readiness; checks PostgreSQL                        |
| `POST /auth/register`                           | `{ "name": "Sam", "email": "sam@example.com", "password": "a long unique passphrase" }` | Public; creates session; password 12–128 characters |
| `POST /auth/login`                              | `{ "email": "sam@example.com", "password": "a long unique passphrase" }`                | Public; creates session                             |
| `POST /auth/logout`                             | `{}`                                                                                    | Session required; revokes current session           |
| `GET /auth/session`                             | —                                                                                       | Current sanitized user; 401 if absent/expired       |
| `GET /organizations`                            | —                                                                                       | Lists current user's memberships only               |
| `POST /organizations`                           | `{ "name": "Agency", "slug": "my-agency" }`                                             | Session required; creator becomes owner             |
| `GET /organizations/:organizationId`            | —                                                                                       | Member required                                     |
| `PATCH /organizations/:organizationId`          | `{ "name": "New name" }`                                                                | Owner/admin required                                |
| `GET /organizations/:organizationId/audit-logs` | —                                                                                       | Owner/admin; latest 100 tenant events               |

API responses always exclude passwords, hashes, and session tokens. Duplicate registration uses a generic authentication failure; login failures have the same status/message for unknown email and wrong password. Organization non-members receive 404. Invalid input returns 400; invalid Origin or insufficient role 403; duplicate organization slug 409; oversized bodies 413; throttled requests 429. Auth endpoints allow 10 requests per connection IP per endpoint per minute per API process.

Errors have the form:

```json
{
  "error": {
    "code": "ORGANIZATION_NOT_FOUND",
    "message": "The requested organization was not found.",
    "requestId": "server-generated-correlation-id"
  }
}
```

Errors do not include stack traces, SQL, raw auth-library errors, or request bodies. `X-Request-Id` is generated by the API; caller IDs are not trusted. Responses use `Cache-Control: no-store`.

## Sites and connector

| Method / path                               | Body                                     | Access/result                                                                         |
| ------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------- |
| `GET /organizations/:organizationId/sites`  | —                                        | Member; up to 1000 undeleted sites                                                    |
| `POST /organizations/:organizationId/sites` | `{ name, canonicalUrl }`                 | Verified owner/admin; public DNS validation; 201                                      |
| `GET /sites/:siteId`                        | —                                        | Member; no secret/hash fields                                                         |
| `PATCH /sites/:siteId`                      | `{ name }`                               | Verified owner/admin; URL and tenant immutable                                        |
| `DELETE /sites/:siteId`                     | `{}` or no body                          | Verified owner/admin; soft delete, revoke credential and codes                        |
| `POST /sites/:siteId/pairing-challenges`    | `{}` or no body                          | Verified owner/admin; `{ challenge, expiresAt }`, replaces previous code              |
| `POST /sites/:siteId/rotate-credential`     | `{}` or no body                          | Verified owner/admin; revoke immediately and return new pairing code                  |
| `POST /sites/:siteId/disconnect`            | `{}` or no body                          | Verified owner/admin; revoke credential and codes                                     |
| `POST /connector/pair`                      | `{ challenge, canonicalUrl }`            | Possession of unexpired code; `{ siteId, credential, heartbeatIntervalSeconds: 900 }` |
| `POST /connector/heartbeat`                 | `{ siteId, sequence, connectorVersion }` | Site bearer credential; strictly increasing positive integer sequence                 |
| `POST /connector/disconnect`                | `{ siteId }`                             | Site bearer credential; revoke itself and pending codes                               |
| `POST /connector/inventory`                 | Minimized inventory payload              | Site bearer credential; replaces the latest site snapshot                             |

Connector POST requests send `Origin: <APP_ORIGIN>` and (except pairing) `Authorization: Bearer <credential>`. Never send secrets in query strings, logs, or browser storage. Pairing returns a credential only once; browser site APIs never expose it. Codes have 256-bit entropy and a ten-minute TTL. Pairing requires the normalized WordPress home URL to match the site identity, including subdirectory. The code proves possession, not independent domain ownership. A successful pair starts pending; heartbeat sets active.

Non-members and deleted sites return `SITE_NOT_FOUND` (404); insufficient roles or unverified managing users return 403. Invalid/expired/consumed codes return `INVALID_CHALLENGE` (400), invalid/revoked bearer credentials `INVALID_CREDENTIAL` (401), duplicate/reordered heartbeat `HEARTBEAT_REPLAY` (409). Heartbeats use database receipt time and do not accept client timestamps. Version is a numeric three-part version, sequence is 1–2147483647. Re-pair after sequence exhaustion. Pairing allows 20 requests/minute/IP and each authenticated connector endpoint 120/minute/IP. These process-local limits require tuning and shared storage before public scale.

Member administration, arbitrary alert-policy/channel management and billing endpoints are not mounted. Unimplemented endpoints return the standard 404. Inventory contains only WordPress/PHP versions, active plugin/theme identifiers and versions, update counts, and a server receipt timestamp.

## External monitoring and incidents

`GET /sites/:siteId` also returns tenant-scoped `security` findings and independent inventory/local-file/public-advisory coverage. Connector inventory includes installed active/inactive components, available update versions, selected environment flags, and bounded local scan metadata. The inventory endpoint has a 512 KiB body limit. Connected-site scanning remains local and uploads no source contents; only rule IDs and paths relative to `wp-content` are reported. Separately, a verified administrator may explicitly upload a plugin/theme ZIP to the tenant attachment library for storage, static inspection and approved installation. See [security inventory](SECURITY_INVENTORY.md) and [software management](SOFTWARE_MANAGEMENT.md).

## Software attachments and package delivery

| Method / path                                                     | Body/result                                                                                      | Access                                                                                      |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| `GET /organizations/:organizationId/attachments`                  | Sanitized metadata, scan findings, SHA-256 and workspace quota; never ZIP bytes                  | Organization member                                                                         |
| `POST /organizations/:organizationId/attachments/:kind`           | Raw `application/zip`, maximum 8 MiB; scan/store or return the existing same-hash package        | Verified owner/admin, trusted Origin                                                        |
| `DELETE /organizations/:organizationId/attachments/:attachmentId` | No body; refuses a package referenced by a nonterminal software operation                        | Verified owner/admin, trusted Origin                                                        |
| `POST /connector/software-package`                                | `{ siteId, operationId, token }`; returns the approved ZIP with `application/zip` and `no-store` | Exact current site bearer and fresh running-operation lease; local package opt-in rechecked |

The upload scanner automatically detects the unique root slug from archive entries (not the filename); it requires one matching WordPress root slug/header and rejects unsafe or unsupported ZIP structures before storage. Findings and stale scanner versions block installation. Package delivery is not a general download endpoint and has no browser/public URL. Preview, confirmation and dispatch recheck tenant authority, attachment kind/slug, scan result and Connector capability. The delivery endpoint additionally rechecks operation generation, actor authority, package size and SHA-256. See [software management](SOFTWARE_MANAGEMENT.md) for quotas, static-scan limits and Connector behavior.

| Method / path                                           | Body           | Access/result                                                                          |
| ------------------------------------------------------- | -------------- | -------------------------------------------------------------------------------------- |
| `GET /sites/:siteId`                                    | —              | Member; also returns sanitized `monitoring` states/last/next timestamps; no job leases |
| `GET /sites/:siteId/checks`                             | —              | Member; `{ checks }`, latest 100 results                                               |
| `GET /sites/:siteId/incidents`                          | —              | Member; `{ incidents }`, latest 100 by start time                                      |
| `GET /organizations/:organizationId/incidents`          | —              | Member; latest 100 incidents, excluding deleted sites                                  |
| `POST /sites/:siteId/incidents/:incidentId/acknowledge` | `{}` or absent | Verified owner/admin and trusted Origin; idempotent acknowledgement                    |

Non-members/deleted sites return 404. A foreign or nonexistent incident on an authorized site returns `INCIDENT_NOT_FOUND` (404); members and unverified administrators cannot acknowledge. Acknowledgement never closes an incident or suppresses checks. Check fields include type, server timestamp, result, HTTP status, latency, certificate expiry and safe error code. Incident fields include type, severity, lifecycle timestamps and `resolutionReason` (`recovered` or `connection_reset` when resolved). No public endpoint accepts probe results, schedules arbitrary fetches, changes target identity or exposes lease tokens. Reads are bounded history snapshots; pagination and aggregate availability percentages are deferred.

# Email branding

See [EMAIL_BRANDING.md](EMAIL_BRANDING.md) for authenticated account `GET/PATCH /api/v1/users/me/email-branding`, allowlisted platform `GET/PATCH /api/v1/admin/branding`, strict request contracts and the narrowly extended global-branding administration exception.
