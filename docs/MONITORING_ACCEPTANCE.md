# HTTP / SSL monitoring acceptance

This milestone implements external HTTP availability, SSL expiry, incidents and acknowledgement. Automated tests are evidence of local behavior; they do not certify a live VPS, actual WordPress installation, firewall policy or email delivery. No production changes or live acceptance were performed by this implementation task.

## Local verification

Install Node/pnpm, Docker and OpenSSL (Git for Windows includes OpenSSL). Run `pnpm check`, `pnpm db:check`, `pnpm compose:check` and `pnpm build`. Start a disposable PostgreSQL database using `pnpm test:db:up`, set TEST_DATABASE_URL to its `_test` database and run `pnpm test:integration`; finally run `pnpm test:db:down`. Never use a customer or production database. Run `pnpm test:plugin` with PHP 8.1+.

Unit coverage includes blocked public/private address combinations, metadata/mapped/IPv6 targets, pinned sockets, same-host DNS rebinding, private redirects, downgrade, redirect budgets, slow DNS/network, sanitized failures, expiry thresholds, real HTTP headers and real TLS trust/hostname rejection. TLS fixtures generate temporary keys outside the repository and remove them after tests. Integration coverage includes repeat migrations, scheduler claims, lease expiry/fencing, outage/recovery, incident deduplication, role/Origin/tenant restrictions, acknowledgement, disconnect/re-pair invalidation, deletion and retention.

Local implementation checkpoint, 2026-10-24:

| Check                                  | Result                                                                                                                                                                              |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm check`                           | Formatting, zero-warning lint, workspace types and 84 unit tests passed                                                                                                             |
| `pnpm test:integration`                | 62 tests passed against a dedicated disposable PostgreSQL 17 database, isolated from existing services                                                                              |
| `pnpm build`                           | API, worker and Next.js production build passed                                                                                                                                     |
| `pnpm db:check`, `pnpm compose:check`  | Migration consistency and production/development/test isolation assertions passed                                                                                                   |
| Plugin syntax/contracts                | Host `pnpm test:plugin` could not run without PHP; both syntax checks and all 32 assertions passed in a disposable PHP 8.4 container                                                |
| Deployment checks                      | Config-generation/Compose parsing, Actionlint, ShellCheck, shell syntax, deployment fault injection, config installation and SSH transport fixtures passed in local/Docker runtimes |
| `pnpm audit --prod --audit-level high` | No known vulnerabilities reported                                                                                                                                                   |

Integration startup still emits the existing Fastify disableRequestLogging deprecation warning. No VPS was contacted and no live WordPress/HTTPS acceptance was performed. Local build and fixture checks do not establish the deployed worker's network policy or real-target behavior.

## Authorized HTTPS staging procedure

1. Complete CONNECTOR_ACCEPTANCE.md, including actual minimized inventory receipt. Use a dedicated staging site you control, separate accounts/organizations, verified administrator email and a known-good public HTTPS certificate. Back up before migration 0003. Never stop a customer site for a test.
2. Deploy the candidate through the existing authorized workflow. Confirm only web publishes a loopback port and PostgreSQL/API remain private. Confirm worker DNS and public 80/443 egress, and apply host firewall restrictions for private services/metadata. Confirm no credentials, response bodies or raw network errors appear in logs.
3. Pair the site and allow a worker poll. Confirm HTTP and SSL states/checks appear on site detail and remain independent of connector freshness. Defaults are HTTP every 300 seconds and SSL every 86400 seconds; due times may be delayed by the bounded queue. For controlled testing use MONITOR_INTERVAL_SECONDS=300 and SSL_INTERVAL_SECONDS=3600, then restore desired settings.
4. Make only the controlled target return 503. The first failed probe must show suspected status; the next due retry (60 seconds plus scheduler delay) must open one critical HTTP incident. Additional failures must not duplicate it. Keep the connector heartbeat running if possible to demonstrate the independent status.
5. A verified owner/admin can acknowledge once; repeats must not create extra audit events. An ordinary member cannot acknowledge. Another organization cannot read the site/checks/incidents or acknowledge its incident, including through direct API requests. Unauthenticated callers must be rejected.
6. Restore the controlled endpoint to 200. One success must show recovering; the second success must resolve the same incident with reason recovered. Recovery confirmation is due 60 seconds later plus scheduling delay. Check the organization incident list and transactional audit events.
7. Validate SSL warning behavior using controlled certificate fixtures with expiry inside 14/7/3 days, allowing two checks for initial confirmation. Trusted normal certificates should show expiry; invalid trust, hostname or expired certificates must fail closed. The unit suite covers these classifications and real TLS rejection; actual staging certificate variants remain a separate acceptance item. Do not disable certificate verification to simulate success.
8. Disconnect or rotate during a due/in-flight probe. Jobs must be removed and old results must not alter current state. Existing incidents close as connection_reset, not recovered. Re-pair creates fresh jobs. Soft-deleted sites disappear from tenant reads and no longer receive probes.
9. Validate safe public redirects, a private-address redirect and an HTTPS downgrade using controlled fixtures. Unsafe destinations must yield a safe error without connecting to private services. Never probe unrelated third-party internal targets. Review public-target abuse limits before broad access: pairing is not independent domain-ownership proof.
10. Set MONITORING_ENABLED=false and redeploy. Confirm external checks stop while heartbeat expiration continues; historical states remain visible. Re-enable after verification. Record revision, time, anonymized evidence, backup/restore results and any failed steps in a separate acceptance report without credentials/customer data.

## Semantics and limits

HTTP availability is a header-level GET result after up to three validated redirects, with response bodies discarded; it does not validate WordPress content or real-user behavior. HTTP 200–399 is healthy after redirect handling, 4xx/5xx including WAF blocks are failures. SSL checks inspect the original HTTPS hostname, not the final redirect hostname. HTTP-only targets have no SSL job. Results reflect a single approved address from one worker region. An invalid/expired certificate may yield only a safe TLS error rather than an expiry timestamp.

Each probe has a ten-second total deadline, five-second socket inactivity timeout and 16 KiB response-header limit. Retries back off from 60 seconds to the lesser of the normal interval and 960 seconds. At most four jobs are claimed per poll, including both HTTP and SSL, so a 60-second poll yields at most about four checks per minute before network/DB time. Measure queue lag and resource use before scaling. History APIs return at most 100 records, while UI shows a shorter recent subset. Checks are retained 30 days, resolved incidents 90 days with bounded deletion; open incidents and audits require their own lifecycle policy. No SLA calculation, multiple regions, custom ports, notification delivery or remote execution is included.

Next milestone after live acceptance: verified notification destinations, transactional delivery queue, idempotent incident/recovery events and bounded retries.
