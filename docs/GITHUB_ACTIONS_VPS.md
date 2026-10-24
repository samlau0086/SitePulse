# GitHub Actions → VPS deployment

This deploys the existing application; it does not complete live WordPress acceptance. Prepare staging first. The Windows local stack is independent and remains running.

## Deployment behavior

`.github/workflows/ci.yml` runs formatting, lint, types, unit/integration/PHP tests, build, dependency audit, Compose isolation assertions, and deployment-script fault injection. A failed check prevents deployment.

- Push to `main`: deploys **staging** only when repository variable `AUTO_DEPLOY_STAGING=true`.
- Actions → **SitePulse checks** → **Run workflow** on `main`: choose `staging` or `production`. Production also requires checking `confirm_production`; without it checks run but deployment is skipped.
- Configure the GitHub `production` environment with required reviewers where your GitHub plan supports them. Restrict both deployment environments to the protected `main` branch. Never grant deployment credentials to PR workflows.

The reusable `deploy.yml` receives environment secrets after any environment approval. It uploads a `git archive` of the checked commit over SSH. A configured `VPS_KNOWN_HOSTS` pins the host key; without it, the workflow discovers and trusts keys for that run only, with no independent server identity verification or cross-run key-change detection. Application secrets remain on the VPS. The VPS builds release-tagged Docker images, validates API/worker environment variables, stops web/API/worker, creates an age-encrypted PostgreSQL dump, applies migrations once, starts the candidate and checks internal and public HTTPS health. The worker is checked for a running process, not heartbeat processing correctness.

This is a single-host deployment with downtime during backup/migration/startup. Only a verified candidate becomes `current`. Failures after the write pause leave the app stopped for operator recovery; migrations are never automatically reversed. Keep previous sources, images, encrypted dumps, and deployment logs. There is no automatic pruning or image rollback.

## 1. Prepare Linux VPS

Use a supported Linux host with Docker Engine and Docker Compose v2, Bash, `curl`, `flock` (util-linux), `age`, and a host reverse proxy such as Caddy or your existing 1Panel/Nginx installation. Allow enough RAM/disk to build Next.js while the existing app runs. Port 22 (or your SSH port), 80 and 443 are public; PostgreSQL/API are private. Deployment account access to Docker is privileged access to this host; use a dedicated account/key.

Have the VPS administrator create the staging directory, replacing `deploy` with the SSH account name:

```sh
sudo install -d -m 700 -o deploy -g deploy /opt/sitepulse-staging
sudo -u deploy mkdir -p /opt/sitepulse-staging/{incoming,releases,shared,backups,logs}
```

For production, repeat with `/opt/sitepulse-production`. Compose project names keep databases/networks separate. Staging defaults to `127.0.0.1:3000`; production defaults to `127.0.0.1:3001`. Override the host port with the GitHub Environment variable `WEB_BIND_PORT` (see section 4). These ports must be free. The deploy script exports the selected port and immutable image tags; do not use an unrelated Compose project name when administering these deployments.

Install a dedicated public SSH deployment key in this account's `~/.ssh/authorized_keys`. Keep the matching private key in the GitHub environment secret below. Do not use the Windows local `.env`, GitHub personal tokens, or WordPress admin passwords as deployment secrets.

## 2. Configure server-only secrets and backups

Copy the template [deploy/vps.env.example](../deploy/vps.env.example) to `/opt/sitepulse-staging/shared/.env` through a secure channel. Set permissions to 600 and fill it using a private editor. Generate independent DB and auth secrets with `openssl rand -hex 48` twice; do not paste them into chat or CI logs. Hex passwords do not need URL encoding.

Required values:

| Name                           | Value                                                                             |
| ------------------------------ | --------------------------------------------------------------------------------- |
| `APP_ORIGIN`                   | Exact public HTTPS origin, without path/trailing slash                            |
| `POSTGRES_USER`, `POSTGRES_DB` | Dedicated application database role/name                                          |
| `POSTGRES_PASSWORD`            | Random password; changing this file does not rotate an existing database password |
| `BETTER_AUTH_SECRET`           | Independent random secret, retained across releases                               |
| `AUTH_MAIL_TRANSPORT`          | `resend`                                                                          |
| `AUTH_MAIL_FROM`               | Sender email on your verified Resend domain                                       |
| `RESEND_API_KEY`               | Real provider key stored only on VPS                                              |

Compose constructs the internal database URL. Do not add localhost `DATABASE_URL` or `TEST_DATABASE_URL`; no test suite runs against this database. Production cookie/HTTPS validation remains enabled even for staging. File email transport is intentionally refused here.

On a separate trusted administrator machine, create an age key with `age-keygen -o sitepulse-backup.key`. Protect and retain the **private** key off the VPS; its loss makes encrypted backups unrecoverable. Put only the printed **public recipient** (`age1…`) into `/opt/sitepulse-staging/shared/backup-recipient.txt`, one line. Put the same origin as `APP_ORIGIN` into `/opt/sitepulse-staging/shared/public-origin.txt`, one line. Make both files mode 600. Repeat independently for production.

Every deployment creates a custom-format encrypted dump in `backups/<release>.dump.age`, including an empty-database dump on first deployment. `pipefail` blocks migration if dump/encryption fails. Interrupted `.partial` files are not complete backups. Logs in `logs/<release>.log` are private diagnostic files; review and redact before sharing.

Configure encrypted off-host backup copies, retention, and a restore drill before production use. This workflow creates local encrypted pre-deployment backups only; it does not schedule daily backups, upload off-site, or prove a dump can be restored. Copy a dump to the trusted administrator machine, decrypt there with `age --decrypt -i sitepulse-backup.key`, and restore with PostgreSQL 17 `pg_restore` into an isolated disposable database. Never restore over a running production database as a test.

## 3. DNS and HTTPS reverse proxy

Point your staging hostname at the VPS. Configure a valid HTTPS host reverse proxy to `127.0.0.1:3000`; production uses `127.0.0.1:3001`. The sample [deploy/Caddyfile.example](../deploy/Caddyfile.example) supports Caddy's certificate issuance for your real hostname. Replace the example hostname, validate configuration, and reload your proxy. Existing 1Panel/Nginx HTTPS sites can use the same upstream. If your proxy itself runs in a container, its loopback is not the host loopback; configure a reviewed host-network/private routing arrangement rather than publishing PostgreSQL or API.

When setting `WEB_BIND_PORT`, change the proxy upstream to the same port, for example `127.0.0.1:18080`. The container still listens on port 3000; PostgreSQL and API remain unpublished. Coordinate proxy changes with deployment because changing a running deployment's port can interrupt access until both match.

Preserve browser `Origin`, reject unknown hosts, apply a 1 MB body cap and bounded upstream timeouts. Do not rewrite the browser Origin to an internal hostname. Do not enable access logging of cookies, Authorization headers, or request bodies. HTTPS must already route to this VPS for the workflow's public health check to pass. Certificate provisioning and DNS changes are manual environment setup, not performed by GitHub Actions.

## 4. Configure GitHub

In the `samlau0086/SitePulse` repository, open **Settings → Environments**, create `staging` and `production`, and add these secrets separately to each environment:

| Secret            | Content                                                                                                               |
| ----------------- | --------------------------------------------------------------------------------------------------------------------- |
| `VPS_HOST`        | VPS hostname or IPv4 address, without protocol/path (IPv6 literals are not supported by this workflow)                |
| `VPS_PORT`        | SSH port; defaults to `22`                                                                                            |
| `VPS_USER`        | Dedicated deploy account                                                                                              |
| `VPS_SSH_KEY`     | Complete OpenSSH private key, dedicated to this deployment; use a non-interactive key                                 |
| `VPS_KNOWN_HOSTS` | Optional trusted OpenSSH known_hosts entry; omitted means automatic per-run discovery; custom ports use `[host]:port` |

You can omit `VPS_KNOWN_HOSTS`. The workflow then runs `ssh-keyscan` with a timeout, aborts if discovery fails or produces no keys, and emits a warning. SSH still uses `StrictHostKeyChecking=yes` against that run's discovered keys. Discovery does not independently authenticate the server, does not detect key changes between runs, and cannot prevent an attacker impersonating the server during the scan. There is no persistent host-key cache.

In **Settings → Environments → staging (or production) → Environment variables**, add `WEB_BIND_PORT`, for example `18080`. This is a **variable**, not a secret. It controls the web container's host port only; `VPS_PORT` controls SSH. Valid values are decimal integers from 1 to 65535 without leading zeroes. The workflow passes the validated port to the VPS script, overriding any same-name entry in the server `.env`. Without the variable, staging uses 3000 and production 3001. Choose different unused ports for environments sharing a host. Binding stays on `127.0.0.1`.

Manual invocation of `scripts/deploy-vps.sh ENVIRONMENT RELEASE [WEB_BIND_PORT]` also accepts the port as its third argument, or from the shell environment when the argument is omitted. A successful deployment records the selected port in `current-web-bind-port.txt`; this record belongs to the last successful release and is unchanged on failed deployments.

To pin the server identity, optionally supply `VPS_KNOWN_HOSTS` after verifying the fingerprint through the VPS provider console or another trusted administrator channel. `ssh-keyscan -p PORT HOST` can collect the entry, but scanning alone does not authenticate it. A configured record is used directly and never silently replaced by discovery.

Under **Settings → Secrets and variables → Actions → Variables**, add repository variable `AUTO_DEPLOY_STAGING=true` when ready for automatic staging deploys on pushes to `main`. Leave it unset during setup. No registry token is needed; Docker builds happen on the VPS. Do not create Actions secrets for the application DB password, Better Auth secret, or Resend key; they stay in the protected VPS `.env`.

Protect `main` and require the checks before merge. Push these workflow files to GitHub through your normal review flow; local uncommitted changes are not deployed. First run the workflow manually on `main` targeting staging, then verify real registration, email delivery, reset, and organization isolation through the HTTPS site. Enable automatic staging deployment after that succeeds.

## 5. Operations and recovery

Inspect status on the VPS using the successful release's Compose file, protected env file and stable project name. For staging:

```sh
cd /opt/sitepulse-staging
export SITEPULSE_RELEASE="$(cat current-release.txt)"
export WEB_BIND_PORT="$(cat current-web-bind-port.txt)"
docker compose -p sitepulse-staging --env-file shared/.env -f current/docker-compose.yml ps -a
```

Keep these variables when running any administrative Compose command. Production uses project/path `sitepulse-production` and its own recorded port. For deployments predating the port record, export the known last successful port explicitly (defaults: staging 3000, production 3001). Do not print resolved Compose configuration or container environments.

For a failure, inspect the protected release log through SSH. If a backup failed, investigate before manually restarting the previous app. If a migration ran or partially ran, review its actual database state first. The previous source path is recorded in `previous-release.txt` after successful promotion, while `current-release.txt` identifies the last successful deployment. Failed candidates never overwrite those markers.

The `VPS_KNOWN_HOSTS is unset` line is a warning, not a failure diagnosis. Workflow errors name the failing stage: configuration validation, host-key discovery, source archive, VPS setup/SSH authentication, source upload, or remote deployment. VPS preflight names missing/unwritable directories and missing/empty/unreadable configuration files without printing file contents. A failure at setup means checking section 1 and section 2 using the configured SSH account; authentication/connection failures also retain SSH diagnostics. A remote build/migration failure prints the phase and protected server log path. Logs are not automatically copied to GitHub because they can contain application/provider diagnostics; review privately and redact before sharing. The workflow intentionally avoids tracing shell commands or echoing credential values.

An application-only rollback is manual and requires a confirmed compatible schema: select a retained previous release directory/tag, export its `SITEPULSE_RELEASE` and the environment's `WEB_BIND_PORT`, then run `docker compose -p sitepulse-staging --env-file /opt/sitepulse-staging/shared/.env -f <previous-release>/docker-compose.yml up --no-build --no-deps -d --wait sitepulse-api sitepulse-worker sitepulse-web`. Verify HTTPS and authentication before marking recovery complete. Do not rerun migrations from an old release or restore a database automatically. For incompatible migrations, use a reviewed forward fix or the authorized isolated-database restoration/cutover described in [DEPLOYMENT.md](DEPLOYMENT.md). Restoring a dump can lose subsequent writes.

The workflow permits one in-flight deployment per environment, and the server lock rejects concurrent manual deploys. Avoid dispatching an older workflow run after a newer deployment; doing so is an intentional version change and needs schema review. Keep disk usage under observation; remove retained releases/images/backups only under a reviewed retention policy. Never run `docker compose down -v` on these projects.
