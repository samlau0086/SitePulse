# Implementation and validation record

Date: 2026-10-24. Scope: authentication recovery and email verification, followed by connector pairing, tenant-isolated sites, and heartbeat freshness. This records local implementation checks, not production deployment or full MVP acceptance.

This is the original implementation checkpoint. Later Docker runtime checks and the current live acceptance blockers are recorded in [STAGING_ACCEPTANCE_REPORT.md](STAGING_ACCEPTANCE_REPORT.md).

The historical results below remain unchanged. Subsequent inventory and HTTP/SSL monitoring implementation is documented in README.md, CHANGELOG.md and [MONITORING_ACCEPTANCE.md](MONITORING_ACCEPTANCE.md); statements below about missing inventory/probes describe this original checkpoint only.

## Delivered behavior

- Better Auth manages expiring password resets, single-use reset consumption, session revocation, and email verification. Recovery requests use generic responses and rate limits. Development uses a private ignored outbox; production requires the configured Resend transport.
- Server membership checks protect every customer site route. Verified owners/admins may mutate sites; members may read. Foreign and deleted sites are hidden. Pairing codes expire after ten minutes and are consumed transactionally once. Only credential hashes are stored by the SaaS; rotation and disconnection revoke credentials immediately.
- The single-site WordPress connector protects administrative actions with capabilities and nonces, stores a non-autoload credential, uses bounded HTTPS requests, and sends sequenced heartbeats with bounded retries. A separate worker marks stale connections degraded; valid heartbeats restore active status. No customer URL fetch, inventory, billing, alert notifications, or remote execution is implemented.

## Changed file groups

| Paths                                                                                                                                 | Changes                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/src`, `apps/api/tests`                                                                                                      | Authentication mail and lifecycle adapters, site authorization, URL validation, pairing, credential lifecycle, heartbeat, and security/concurrency tests |
| `apps/web/app`, `apps/web/components`                                                                                                 | Recovery/verification pages, organization site lists, site detail pages and pairing controls                                                             |
| `apps/worker`                                                                                                                         | Independent heartbeat expiration worker and validated startup                                                                                            |
| `packages/config`, `packages/api-contracts`                                                                                           | Validated mail/worker environments and strict site/connector requests                                                                                    |
| `packages/database/schema`, `packages/database/migrations/0001_windy_guardsmen.sql`, migration metadata                               | Sites, pairing challenges, hash-only credentials and replay state; initial migration preserved                                                           |
| `plugins/sitepulse-connector`                                                                                                         | Installable PHP connector, uninstall behavior and isolated WordPress contract tests                                                                      |
| `Dockerfile`, `docker-compose*.yml`, `.env.example`, `.github/workflows/ci.yml`, `scripts`, root workspace configuration and lockfile | Worker container, private networks, mail configuration, plugin checks and dependencies                                                                   |
| `README.md`, `CHANGELOG.md`, `docs`                                                                                                   | Development commands, security boundaries, architecture, API, deployment and live acceptance procedure                                                   |

At the original implementation checkpoint, foundation files and these additions were untracked and no commit or production migration had been performed. The later acceptance attempt starts from commit `41d7d14`. Local mail, database state, downloaded test runtimes and `.env` files are ignored by Git.

## Validation

| Check                                  | Local result                                                                              |
| -------------------------------------- | ----------------------------------------------------------------------------------------- |
| `pnpm check`                           | Passed formatting, lint with zero warnings, workspace TypeScript checks and 25 unit tests |
| `pnpm test:integration`                | Passed 45 API/database tests against a dedicated disposable PostgreSQL 14 database        |
| `pnpm test:plugin`                     | Passed PHP syntax checks and 32 WordPress contract assertions using PHP 8.4.27            |
| `pnpm build`                           | Passed API, worker and Next.js production build                                           |
| `pnpm db:check`                        | Passed migration journal consistency                                                      |
| `pnpm compose:check`                   | Passed production/development/test configuration validation and port-isolation assertions |
| `pnpm audit --prod --audit-level high` | No known vulnerabilities reported                                                         |
| Docker stack startup                   | Could not run: Docker Desktop Linux engine pipe unavailable                               |

Commands used `npx --yes pnpm@10.32.1` because the installed pnpm shim was unavailable. CI is configured for PostgreSQL 17; local database results above are PostgreSQL 14, not a verified CI execution. Integration startup emits Fastify's deprecation warning for the top-level `disableRequestLogging` option; checks pass with request logging disabled.

## Remaining acceptance and limitations

Docker configuration validation does not prove image builds, stack startup or container networking. PHP contract doubles do not prove behavior inside WordPress. Live WordPress activation, HTTPS pairing, cron heartbeat, stale recovery and rotation/revocation must follow CONNECTOR_ACCEPTANCE.md before connector acceptance is complete. Real Resend delivery with a verified sender also remains unverified. Authentication mail has no durable queue or automatic delivery retry.

WP-Cron depends on traffic unless an operator provides a system trigger. Multisite is unsupported. Pairing proves possession of the code and matching URL, not independent domain ownership. Registration DNS validation does not protect future HTTP fetches from DNS rebinding: connection-time address validation/pinning is required before external monitoring. Heartbeats report freshness rather than uptime. No production deployment or public pilot readiness is claimed.

Next recommended task: complete HTTPS staging acceptance with a real WordPress installation and verified email sender, then implement minimized, size-limited inventory with tenant/credential isolation tests. Keep external HTTP/SSL monitoring as a separate milestone with connection-time SSRF defenses.
