# SitePulse

SitePulse is a multi-tenant workspace for WordPress maintenance providers. Accounts, password recovery, email verification, organizations, isolated sites, WordPress connector pairing, revocable credentials, and heartbeat freshness are implemented. External uptime/SSL probes, inventory, incidents, billing, and alert notifications remain separate milestones.

## Authentication email

Host development defaults to `AUTH_MAIL_TRANSPORT=file`: open the JSON messages in `.local/mail` and follow the link. This directory contains sensitive links; it is ignored by Git and Docker and must never be shared. Registration sends a verification email. `/verify-email` also resends it. `/forgot-password` requests recovery and `/reset-password` confirms a new password. Links use URL fragments, are removed from browser history on load, and require a user action before submitting. Reset links expire after 30 minutes and are single-use; verification links expire after one hour and repeat confirmation is idempotent. Resetting a password revokes all existing sessions.

Production requires `AUTH_MAIL_TRANSPORT=resend`, `AUTH_MAIL_FROM` set to a verified sender email, and `RESEND_API_KEY` injected privately. File transport is refused in production. No real provider messages are sent by tests. Delivery failures produce a sanitized audit event; public request responses remain generic. Automatic delivery retries and a durable email queue are deferred; users can request a new email after correcting provider configuration. Authentication mail is separate from future monitoring alerts.

The complete supplied specification is preserved in [docs/PRODUCT_SPECIFICATION.md](docs/PRODUCT_SPECIFICATION.md). Architecture decisions and deliberate milestone limits are in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Requirements

- Node.js 22.18+ (Node 22 recommended), Corepack, pnpm 10.32.1.
- Docker Engine with Compose v2, or a separately managed PostgreSQL database for host development.
- PHP 8.1+ for plugin syntax/contract tests; WordPress 6.5+ single-site for live plugin acceptance.
- An unused local port 3000 (web), 4000 (API), 5432 (development DB), and 5433 (disposable test DB).

Enable pnpm with `corepack enable` and `corepack prepare pnpm@10.32.1 --activate`. If Corepack is unavailable, use `npx --yes pnpm@10.32.1` in place of `pnpm`.

## Local development

1. Copy `.env.example` to `.env` (`Copy-Item .env.example .env` in PowerShell).
2. Run the following command twice and place independent values in `BETTER_AUTH_SECRET` and `POSTGRES_PASSWORD`. The generated base64url password is safe to embed in `DATABASE_URL`. Never commit `.env`.

   ```sh
   node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
   ```

3. Set `DATABASE_URL` to `postgresql://sitepulse:<your-password>@127.0.0.1:5432/sitepulse`. Keep `APP_ORIGIN=http://localhost:3000` with no trailing slash. Use exactly that origin in the browser.
4. Install dependencies and start the database, then migrate and run the applications:

   ```sh
   pnpm install --frozen-lockfile
   docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --wait sitepulse-db
   pnpm db:migrate
   pnpm dev
   ```

Open `http://localhost:3000`, register, and create an organization. API documentation is available at `http://localhost:3000/api/v1/docs/`; machine-readable OpenAPI is at `/api/v1/docs/json`. API readiness is `/api/v1/health`. Host API listens on port 4000; browser requests use the web origin through a Next.js rewrite.

The API reads the root `.env`; the host web defaults to `http://127.0.0.1:4000`. If you change the API port, export `API_INTERNAL_ORIGIN` before starting/building Next.js. Next.js rewrites are fixed at build time; container builds use `http://sitepulse-api:4000`.

To run the entire application in local containers:

```sh
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build -d --wait
```

This runs a one-shot migration service before starting the API. The development override enables HTTP session cookies and publishes PostgreSQL on loopback only. Stop the stack with the same two `-f` arguments and `down`; database volumes are retained unless explicitly removed.

## Checks and tests

```sh
pnpm check                 # formatting, lint, all workspace types, unit tests
pnpm db:check              # migration journal consistency
pnpm compose:check         # all Compose configurations and port isolation
pnpm test:db:up            # disposable PostgreSQL 17 on loopback port 5433
pnpm test:integration      # real SQL migrations and API integration tests
pnpm test:plugin           # PHP syntax and isolated WordPress API contract checks
pnpm build                # API/worker typecheck and production Next.js build
pnpm audit --prod --audit-level high
pnpm test:db:down          # removes the disposable test container/volume
```

Export `TEST_DATABASE_URL` before `pnpm test:integration` (the test runner deliberately does not load `.env`):

```sh
# POSIX shell
export TEST_DATABASE_URL=postgresql://sitepulse_test:sitepulse_test@127.0.0.1:5433/sitepulse_test
```

```powershell
$env:TEST_DATABASE_URL = 'postgresql://sitepulse_test:sitepulse_test@127.0.0.1:5433/sitepulse_test'
pnpm test:integration
```

Integration tests apply migrations twice, then **truncate all application tables in the configured test database**. They refuse database names that do not end in `_test`. Use a dedicated disposable database, never a production connection string. Fixtures include non-secret credentials usable only against local test infrastructure. Tests cover registration, Argon2id hashes, duplicate accounts, login failures, session cookies, logout, expiration, anonymous/forged sessions, owner/admin/member permissions, membership revocation, cross-tenant reads/writes/audits, CSRF, payload limits, and throttling.

Use `pnpm format` to format source and `pnpm db:generate` after schema edits. Commit generated SQL, metadata, and `pnpm-lock.yaml`. See [database documentation](docs/DATABASE.md) before migrations. CI runs the checks above against PostgreSQL 17; see `.github/workflows/ci.yml`.

## Pair a WordPress site

Verify your email, open an organization, and add its public WordPress home URL (including any subdirectory). Only verified owners/admins may manage sites; members can read them. Registration resolves DNS and rejects non-public addresses, credentials, custom ports, query strings, and fragments. SitePulse does not fetch customer URLs in this milestone.

On the site detail page, create a pairing code. Install the `plugins/sitepulse-connector` directory as a WordPress plugin, activate it, and enter the code and your public SitePulse HTTPS origin in Settings → SitePulse. Codes expire in ten minutes and are single-use. The plugin exchanges the code for a site credential and sends a test heartbeat. Production requires TLS; for local WordPress acceptance, use a controlled public HTTPS staging origin. Do not disable the plugin's safe HTTP/TLS checks for local testing.

The plugin sends a heartbeat every 15 minutes, driven by WP-Cron. Use a system cron trigger on low-traffic installations. After 45 minutes without a heartbeat, the independent worker marks the connection stale (`degraded`); the next valid heartbeat restores `active`. This indicates connector freshness, not website availability. Worker settings are validated: `HEARTBEAT_STALE_SECONDS` (1800–86400, default 2700) and `WORKER_POLL_SECONDS` (10–300, default 60). The dashboard refreshes on reload.

Credential rotation immediately revokes the old credential and issues a fresh pairing code. Disconnect the old connection in WordPress, then pair again. A server-rejected credential (401) can be removed locally; network failures preserve it so revocation can be retried. Plugin deactivation removes cron events but preserves the credential; explicitly disconnect before uninstalling. Uninstall deletes local data and cannot guarantee remote revocation. Multisite is explicitly unsupported. See [connector guide](plugins/sitepulse-connector/README.md) and [acceptance procedure](docs/CONNECTOR_ACCEPTANCE.md).

`pnpm test:plugin` accepts `PHP_BIN` if PHP is outside PATH. Its contract doubles do not replace a live WordPress acceptance run.

## Production configuration

Use only `docker-compose.yml`. Set `APP_ORIGIN` to the external **HTTPS** origin and supply independent production secrets through a secrets manager or protected deployment environment. The API rejects non-HTTPS origins in production. PostgreSQL has no published port and uses a private Docker network. API is internal; web publishes `127.0.0.1:3000` for a host HTTPS reverse proxy. Configure the proxy to preserve browser `Origin`, reject unknown hosts, terminate TLS, and forward requests to that loopback port.

See [deployment and rollback](docs/DEPLOYMENT.md) and [security limits](docs/SECURITY.md). The initial stack is single-instance; do not scale it without shared authentication throttling and a trusted proxy/client-IP design. This milestone is not ready for a public paid launch.

## Repository map

| Location                      | Responsibility                                                                                   |
| ----------------------------- | ------------------------------------------------------------------------------------------------ |
| `apps/web`                    | Next.js, React, Tailwind, accessible Radix form labels; login, registration, protected workspace |
| `apps/api`                    | Fastify REST API, Better Auth bridge, authorization, integration tests                           |
| `apps/worker`                 | Independent bounded heartbeat expiration sweeps with PostgreSQL row locks                        |
| `packages/database`           | Drizzle schema, SQL migrations, PostgreSQL connection/migration helpers                          |
| `packages/api-contracts`      | Shared strict Zod request contracts and public types                                             |
| `packages/config`             | Validated server environment variables                                                           |
| `packages/shared`             | Shared role policy                                                                               |
| `plugins/sitepulse-connector` | Installable single-site WordPress pairing/heartbeat plugin and PHP contract checks               |
| `docs`                        | Full specification, architecture, API, security, deployment and milestone tracking               |

Next task: run the live WordPress acceptance procedure against HTTPS staging, then add minimized inventory with validation and size limits. External uptime/SSL monitoring needs connection-time DNS/IP pinning, redirect validation, bounded jobs, and outage/recovery tests before it is enabled.
