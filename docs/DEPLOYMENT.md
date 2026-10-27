# Deployment, backups, and rollback

This repository supplies deployment configuration and an opt-in GitHub Actions VPS workflow. No VPS is contacted until its GitHub environment/SSH settings are configured and a deployment is triggered. Production changes require explicit authorization; the workflow requires a manual production confirmation. See [GitHub Actions VPS setup](GITHUB_ACTIONS_VPS.md).

## Local containers

Prepare `.env` as described in README.md, then run:

```sh
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build -d --wait
docker compose -f docker-compose.yml -f docker-compose.dev.yml logs --tail 100 sitepulse-api sitepulse-migrate
```

Only the development override publishes PostgreSQL, bound to `127.0.0.1`. That file also enables non-Secure cookies for local HTTP. Use a base64url DB password; other passwords must be URL-encoded in connection strings. Changing `POSTGRES_PASSWORD` does not rotate an initialized database's password; perform rotation explicitly.

## Production preparation

Use the base `docker-compose.yml` only. Set `APP_ORIGIN=https://your-hostname` with no path/trailing slash, an independent random `BETTER_AUTH_SECRET`, and independent production DB credentials. Prefer injection from a secret manager. Compose rejects empty required secrets; API validation rejects malformed or placeholder configuration. Do not print resolved Compose configuration where it can expose credentials; use `docker compose config --quiet`.

The base configuration publishes only the web port, loopback by default (configurable via WEB_BIND_PORT). Run an HTTPS host reverse proxy with a valid certificate. Preserve browser Origin, reject unrecognized hostnames, and apply request timeouts and limits. The API and PostgreSQL are not public; the database network is internal. The worker also has a monitoring bridge for outbound DNS and public HTTP/HTTPS; it publishes no port and PostgreSQL is not attached to that bridge. Apply host egress policy as defense in depth. The public Next rewrite destination is compiled into the web image; rebuilding is required if the internal service origin changes.

Back up the database and record the currently deployed image/source revision before any migration. Build and test the candidate in staging. Start only one migration runner. Compose waits for database readiness, applies migrations, then starts the API, heartbeat worker and web. A migration failure prevents application startup. Inspect migration and health results before routing traffic. Verify the worker process remains running and stale transitions are applied; the worker does not expose a network health endpoint.

Set AUTH_MAIL_TRANSPORT=resend, AUTH_MAIL_FROM to a verified provider sender, and inject RESEND_API_KEY privately. Confirm actual signup verification and reset delivery in staging. Mail is synchronous without a durable retry queue; generic public responses do not confirm delivery. Protect `.local/mail` development outbox and ensure the bind mount is writable by the container's node user. The worker requires database/freshness/monitoring settings and cannot send email.

External probes default to enabled for paired sites. Optional environment/GitHub variables are MONITORING_ENABLED (true/false), MONITOR_INTERVAL_SECONDS (300 default, 60–3600), and SSL_INTERVAL_SECONDS (86400 default, 3600–604800). GitHub deployment validates and installs these in the private generated configuration. Set MONITORING_ENABLED=false and redeploy to pause probes while preserving history and heartbeat expiration. Apply migration 0003 only after the deployment backup. A worker claims four jobs per sweep; monitor due-job lag before expanding beyond a small pilot. Complete MONITORING_ACCEPTANCE.md before claiming live acceptance or adding alerts.

The Actions VPS workflow reads application secrets/variables from GitHub Environments, validates them through packages/config, creates directories and transfers private configuration over SSH automatically on first and subsequent deployments. No manual VPS `.env` or backup/origin files are required. It refuses implicit database credential changes and installs missing age/curl/flock helpers on Debian/Ubuntu root hosts. Docker/Compose and working SSH access remain prerequisites. It supplies encrypted pre-migration backups, release image tags and health verification. DNS/TLS routing, off-host backup scheduling/retention, deployment-specific resource limits and production monitoring still need environment-specific configuration before launch. API runtime currently includes build tooling; prune it in a later deployment hardening task.

## Backup and recovery

Use `pg_dump --format=custom` against a private database connection using a protected credentials mechanism (such as `PGPASSFILE`), encrypt the dump, and store it outside the server. Never place dumps inside Git or a public web directory. Set retention and access policies before production. A backup is verified only after a successful restore drill into an isolated database.

For an application-only regression with a compatible schema, restore the previous recorded image revision and check API health and login/organization flows. Schema migrations are forward-only: prefer a reviewed corrective migration. For destructive or incompatible changes, stop writes, restore the verified pre-migration backup into a separate database, validate data, then cut over during an authorized maintenance window. Restoring an older backup can lose later writes; plan reconciliation. Never run an automatic destructive down-migration or `docker compose down -v` on production.
