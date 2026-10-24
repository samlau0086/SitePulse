# Staging acceptance attempt — 2026-10-24

Status: local prerequisites verified; live HTTPS WordPress and authentication-mail acceptance blocked by missing environment details. Inventory implementation has not started because the requested sequence requires acceptance first.

## Local evidence

Baseline: commit `41d7d14`. Docker Desktop was installed but stopped. Starting it restored Docker Engine 29.8.0. No production environment was accessed or changed.

| Check                                         | Result                                                                                                             |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Frozen dependency installation                | Passed using pnpm 10.32.1                                                                                          |
| `pnpm check`                                  | Passed formatting, zero-warning lint, workspace types and 25 unit tests                                            |
| `pnpm test:integration` on host PostgreSQL 14 | 45 passed against a dedicated disposable database                                                                  |
| `pnpm test:plugin`                            | PHP syntax checks and 32 contract assertions passed on PHP 8.4.27                                                  |
| `pnpm build`                                  | API, worker and Next.js production build passed                                                                    |
| `pnpm db:check` and `pnpm compose:check`      | Passed                                                                                                             |
| Production dependency audit                   | No known vulnerabilities reported                                                                                  |
| Dockerfile `api`, `worker`, `web` targets     | All three images built successfully                                                                                |
| Base Compose configuration runtime            | Disposable isolated stack started; migrations exited successfully; PostgreSQL, API and web healthy; worker running |
| Web/proxy smoke checks                        | `/` and `/api/v1/health` returned success through `127.0.0.1:3000`                                                 |
| Database/network configuration                | PostgreSQL 17.11; database/API had no published ports; only web published loopback port 3000                       |

The local runtime check used independent random values held in process memory, an invalid example HTTPS origin and a disposable placeholder mail key. It made only local HTTP health requests and sent no email. This is not TLS, actual sender, browser authentication, or WordPress acceptance. Disposable Compose projects use separate databases ending in `_test`; their containers, networks and volumes are removed after checks. Built images and build cache remain local. Existing host PostgreSQL data is preserved.

The PostgreSQL 17.11 container integration run passed all 45 tests in Linux, using a separate disposable Compose database. The first attempt failed before tests because Vite attempted to write its generated config into the non-root application's protected `/app` directory. The successful retry used a writable temporary test copy without changing application ownership or runtime permissions. All disposable test containers, networks and database volumes were removed afterward. Host and container tests emit Fastify's existing `disableRequestLogging` deprecation warning.

## Live acceptance blockers

No staging origin, staging deployment target, WordPress test-site URL, or real authentication mail configuration was found in the project or relevant environment variables. There is no root `.env`. Existing WordPress credential variable names alone do not identify an authorized test installation; their values were not printed or used.

To resume the procedure in CONNECTOR_ACCEPTANCE.md, provide:

- A dedicated SitePulse HTTPS staging origin and the authorized deployment/access method, or an existing running staging instance with web, API, private PostgreSQL and worker.
- A disposable single-site WordPress URL and access method for installing and exercising the connector, with valid outbound HTTPS access to staging.
- A verified Resend sender, provider key supplied through a protected local environment file or secret store, and a designated test recipient. Do not paste secrets into chat or commit them.
- Confirmation of the dedicated staging database and backup location before applying staging migrations, if deployment is needed.

Real verification/reset mail, TLS/proxy behavior, live plugin activation, capability/nonce checks, pairing, cron timing, replay, stale recovery, rotation, disconnect and uninstall remain unexecuted against staging. Contract tests do not replace these checks.

After live acceptance passes, implement only minimized inventory: validated, size-limited WordPress/PHP versions, active plugin/theme identifiers and versions, update counts and server receipt timestamps, with credential-scoped writes, membership-scoped reads and cross-tenant tests. Customer content, plugin settings, credentials and user records must not be collected.
