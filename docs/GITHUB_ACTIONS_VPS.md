# GitHub Actions → VPS deployment

This deploys the existing application; it does not complete live WordPress acceptance. Prepare staging first. The Windows local stack is independent and remains running.

## Deployment behavior

`.github/workflows/ci.yml` runs formatting, lint, types, unit/integration/PHP tests, build, dependency audit, Compose isolation assertions, and deployment-script fault injection. A failed check prevents deployment.

After installing dependencies, run the additional deployment checks locally with Docker available: `node scripts/test-prepare-vps-config.mjs` validates real config generation and literal values inside a disposable container. On Linux/WSL, run `node scripts/test-deploy-ssh.mjs`, `bash scripts/test-vps-config.sh`, and `bash scripts/test-deploy-vps.sh` for transport, initialization and failure handling. These checks use disposable fixtures and never connect to a VPS or the application database.

- Push to `main`: deploys **staging** only when repository variable `AUTO_DEPLOY_STAGING=true`.
- Actions → **SitePulse checks** → **Run workflow** on `main`: choose `staging` or `production`. Production also requires checking `confirm_production`; without it checks run but deployment is skipped.
- Configure the GitHub `production` environment with required reviewers where your GitHub plan supports them. Restrict both deployment environments to the protected `main` branch. Never grant deployment credentials to PR workflows.

The reusable `deploy.yml` receives GitHub Environment secrets after any environment approval. It validates app settings through packages/config before SSH, uploads a `git archive` of the checked commit, and sends generated configuration separately through SSH stdin. Application secrets never enter the source archive, Docker build context or Actions artifacts. Temporary runner files are removed on exit. A configured `VPS_KNOWN_HOSTS` pins the host key; without it, per-run discovery does not independently verify identity or detect changes across runs. The VPS builds release-tagged images, validates API/worker settings, stops writers, creates an age-encrypted PostgreSQL dump, migrates once, starts the candidate and checks internal/public HTTPS health. Worker verification checks its process, not heartbeat processing correctness.

This is a single-host deployment with downtime during backup/migration/startup. Only a verified candidate becomes `current`. Failures after the write pause leave the app stopped for operator recovery; migrations are never automatically reversed. Keep previous sources, images, encrypted dumps, and deployment logs. There is no automatic pruning or image rollback.

## 1. Prepare Linux VPS

Use a Linux host with Docker Engine, Docker Compose v2, Bash, working SSH key access, and your existing HTTPS reverse proxy. Root deployments on Debian/Ubuntu automatically install missing `age`, `curl` and `flock` (util-linux) using apt; hosts already containing them are unchanged. Other systems/accounts require these utilities already available. Docker and unrelated containers are not replaced. Allow enough RAM/disk to build Next.js. PostgreSQL/API remain private. Docker account access is privileged host access; use a dedicated key.

The workflow automatically creates `/opt/sitepulse-staging` (or `/opt/sitepulse-production`) and its `incoming`, `releases`, `shared`, `backups`, and `logs` subdirectories over SSH before validating configuration. With root SSH access, no manual directory creation is needed. New directories use mode 700 via umask 077. Existing directory permissions/owners and all files remain unchanged; repeated setup is safe. It does not invoke sudo, change ownership or clear directories.

With the user's existing root key, no VPS setup commands are needed. A non-root deployment account must already have permission to create the deployment directory and operate Docker; the workflow does not silently grant privileges.

For production, repeat with `/opt/sitepulse-production`. Compose project names keep databases/networks separate. Staging defaults to `127.0.0.1:3000`; production defaults to `127.0.0.1:3001`. Override the host port with the GitHub Environment variable `WEB_BIND_PORT` (see section 4). These ports must be free. The deploy script exports the selected port and immutable image tags; do not use an unrelated Compose project name when administering these deployments.

Use a key already authorized for the SSH account and store its matching private key in the GitHub Environment secret below. Do not reuse the Windows local `.env`, GitHub personal tokens or WordPress passwords as application credentials.

## 2. Automatic configuration and backups

All required settings are entered in GitHub (section 4). Do not create files manually on the VPS. Actions automatically creates `shared/.env`, `shared/backup-recipient.txt` and `shared/public-origin.txt` with mode 600, under the deployment lock. The [env template](../deploy/vps.env.example) documents the generated format only.

Generate two independent stable credentials on your own trusted computer using `node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"`, once for the database and once for authentication. Keep the database password URL-safe (letters, digits, `_`, `-`, at least 32 characters). Never generate replacement secrets on every deployment. Dotenv values are serialized literally; quotes, backslashes and control characters in auth/provider secrets are rejected before transfer. Logs show field names only on validation errors.

Required values:

| Name                           | Value                                                                             |
| ------------------------------ | --------------------------------------------------------------------------------- |
| `APP_ORIGIN`                   | Exact public HTTPS origin, without path/trailing slash                            |
| `POSTGRES_USER`, `POSTGRES_DB` | Dedicated application database role/name                                          |
| `POSTGRES_PASSWORD`            | Random password; changing this file does not rotate an existing database password |
| `BETTER_AUTH_SECRET`           | Independent random secret, retained across releases                               |
| `AUTH_MAIL_TRANSPORT`          | `resend`                                                                          |
| `AUTH_MAIL_FROM`               | Sender email on your verified Resend domain                                       |
| `RESEND_API_KEY`               | Real provider key stored in a GitHub Environment secret and private VPS config    |

Compose constructs the internal database URL. Do not add localhost `DATABASE_URL` or `TEST_DATABASE_URL`; no test suite runs against this database. Production cookie/HTTPS validation remains enabled even for staging. File email transport is intentionally refused here.

On your own trusted administrator computer, create an age key with `age-keygen -o sitepulse-backup.key`. Protect and retain the **private** key outside both VPS and GitHub; losing it makes encrypted backups unrecoverable. Put only the printed **public recipient** (`age1…`) into GitHub Variable `BACKUP_AGE_RECIPIENT`. Actions derives the public-origin file from `APP_ORIGIN`. No command is required on the VPS. Use independent production credentials.

GitHub becomes the source of truth on every release. When adopting an existing VPS configuration, copy its current DB/auth credentials into GitHub. Changes to database user/name/password are rejected before overwriting files: updating dotenv does not rotate initialized PostgreSQL credentials. A deliberate database rotation needs a separate reviewed operation. Authentication secret changes can invalidate existing sessions. Updating config does not restart current containers until the normal verified deployment path; the config represents the requested deployment even if a later build fails. Automatic rollback is not provided.

Every deployment creates a custom-format encrypted dump in `backups/<release>.dump.age`, including an empty-database dump on first deployment. `pipefail` blocks migration if dump/encryption fails. Interrupted `.partial` files are not complete backups. Logs in `logs/<release>.log` are private diagnostic files; review and redact before sharing.

Configure encrypted off-host backup copies, retention, and a restore drill before production use. This workflow creates local encrypted pre-deployment backups only; it does not schedule daily backups, upload off-site, or prove a dump can be restored. Copy a dump to the trusted administrator machine, decrypt there with `age --decrypt -i sitepulse-backup.key`, and restore with PostgreSQL 17 `pg_restore` into an isolated disposable database. Never restore over a running production database as a test.

## 3. DNS and HTTPS reverse proxy

Point your staging hostname at the VPS. Configure a valid HTTPS host reverse proxy to `127.0.0.1:3000`; production uses `127.0.0.1:3001`. The sample [deploy/Caddyfile.example](../deploy/Caddyfile.example) supports Caddy's certificate issuance for your real hostname. Replace the example hostname, validate configuration, and reload your proxy. Existing 1Panel/Nginx HTTPS sites can use the same upstream. If your proxy itself runs in a container, its loopback is not the host loopback; configure a reviewed host-network/private routing arrangement rather than publishing PostgreSQL or API.

When setting `WEB_BIND_PORT`, change the proxy upstream to the same port, for example `127.0.0.1:18080`. The container still listens on port 3000; PostgreSQL and API remain unpublished. Coordinate proxy changes with deployment because changing a running deployment's port can interrupt access until both match.

The selected upstream is **HTTP**, not HTTPS: the TLS certificate belongs on the public reverse proxy at port 443. If Cloudflare reports HTTP `525` during deployment, its connection to the origin proxy failed TLS negotiation. Check that the hostname in `APP_ORIGIN` resolves to this VPS, the proxy has a valid certificate for that hostname, Cloudflare SSL/TLS mode is `Full (strict)` with a trusted origin certificate, and the proxy forwards HTTP to exactly `127.0.0.1:${WEB_BIND_PORT}`. Do not configure the proxy upstream as `https://127.0.0.1:18080`; that sends TLS to the plain HTTP web container. A stale `3000` upstream or a proxy container that cannot reach the host loopback causes the health check to fail as well. The workflow intentionally leaves the application stopped after a failed public verification; after correcting the proxy, rerun the same staging workflow so it starts and verifies the release again.

Preserve browser `Origin`, reject unknown hosts, apply a 1 MB body cap and bounded upstream timeouts. Do not rewrite the browser Origin to an internal hostname. Do not enable access logging of cookies, Authorization headers, or request bodies. HTTPS must already route to this VPS for the workflow's public health check to pass. Certificate provisioning and DNS changes are manual environment setup, not performed by GitHub Actions.

## 4. Configure GitHub

In the `samlau0086/SitePulse` repository, open **Settings → Environments**, create `staging` and `production`, and add these secrets separately to each environment:

| Secret               | Content                                                                                                               |
| -------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `VPS_HOST`           | VPS hostname or IPv4 address, without protocol/path (IPv6 literals are not supported by this workflow)                |
| `VPS_PORT`           | SSH port; defaults to `22`                                                                                            |
| `VPS_USER`           | Dedicated deploy account                                                                                              |
| `VPS_SSH_KEY`        | Complete OpenSSH private key, dedicated to this deployment; use a non-interactive key                                 |
| `VPS_KNOWN_HOSTS`    | Optional trusted OpenSSH known_hosts entry; omitted means automatic per-run discovery; custom ports use `[host]:port` |
| `POSTGRES_PASSWORD`  | Stable independent random URL-safe password, at least 32 characters                                                   |
| `BETTER_AUTH_SECRET` | Stable independent random authentication secret, at least 32 characters                                               |
| `RESEND_API_KEY`     | Real Resend API key                                                                                                   |

Add these **Environment variables** in the same environment:

Optional `PLATFORM_ADMIN_USER_IDS`: comma-separated verified Better Auth user UUIDs, empty by default (no platform administrators). Log in, open `/api/v1/auth/session` and copy `user.id`; add the UUID in this GitHub Environment and redeploy. This enables `/app/admin` workspace entitlement administration only. Organization roles do not grant platform authority. Removing a UUID and redeploying revokes its platform permission. See README and [ENTITLEMENTS.md](ENTITLEMENTS.md) for preview, audit and concurrency behavior. No manual VPS file editing is needed.

| Variable                       | Value                                                                                                                       |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `APP_ORIGIN`                   | Public HTTPS origin without port, path or trailing slash                                                                    |
| `AUTH_MAIL_FROM`               | Sender email on a verified Resend domain                                                                                    |
| `BACKUP_AGE_RECIPIENT`         | Public backup recipient printed by age-keygen; never the private key                                                        |
| `WEB_BIND_PORT`                | Optional free host port; staging defaults 3000, production 3001                                                             |
| `POSTGRES_USER`, `POSTGRES_DB` | Optional, default `sitepulse`; lowercase letters/digits/underscore, starts with a letter or underscore, up to 63 characters |
| `MONITORING_ENABLED`           | Optional `true`/`false`, default `true`; pause external probes while retaining history                                      |
| `MONITOR_INTERVAL_SECONDS`     | Optional HTTP interval, default `300`, allowed `60`–`3600`                                                                  |
| `SSL_INTERVAL_SECONDS`         | Optional SSL interval, default `86400`, allowed `3600`–`604800`                                                             |

The deployment forces production mode and Resend transport. Invalid/missing application settings fail before any SSH connection. Keep runtime credentials stable; no local development or test credentials are injected.

Monitoring variables are validated and installed in the generated private dotenv alongside existing settings. The worker needs outbound DNS and public HTTP/HTTPS access through its monitoring network; it exposes no port and PostgreSQL remains internal. A process health check does not establish monitoring correctness. After migration 0003, complete [monitoring acceptance](MONITORING_ACCEPTANCE.md) with a controlled target. Set MONITORING_ENABLED=false and redeploy to pause probes; stored state/history stays visible and connector freshness continues.

You can omit `VPS_KNOWN_HOSTS`. The workflow then runs `ssh-keyscan` with a timeout, aborts if discovery fails or produces no keys, and emits a warning. SSH still uses `StrictHostKeyChecking=yes` against that run's discovered keys. Discovery does not independently authenticate the server, does not detect key changes between runs, and cannot prevent an attacker impersonating the server during the scan. There is no persistent host-key cache.

In **Settings → Environments → staging (or production) → Environment variables**, add `WEB_BIND_PORT`, for example `18080`. This is a **variable**, not a secret. It controls the web container's host port only; `VPS_PORT` controls SSH. Valid values are decimal integers from 1 to 65535 without leading zeroes. The workflow passes the validated port to the VPS script, overriding any same-name entry in the server `.env`. Without the variable, staging uses 3000 and production 3001. Choose different unused ports for environments sharing a host. Binding stays on `127.0.0.1`.

Manual invocation of `scripts/deploy-vps.sh ENVIRONMENT RELEASE [WEB_BIND_PORT]` also accepts the port as its third argument, or from the shell environment when the argument is omitted. A successful deployment records the selected port in `current-web-bind-port.txt`; this record belongs to the last successful release and is unchanged on failed deployments.

To pin the server identity, optionally supply `VPS_KNOWN_HOSTS` after verifying the fingerprint through the VPS provider console or another trusted administrator channel. `ssh-keyscan -p PORT HOST` can collect the entry, but scanning alone does not authenticate it. A configured record is used directly and never silently replaced by discovery.

Under **Settings → Secrets and variables → Actions → Variables**, add repository variable `AUTO_DEPLOY_STAGING=true` when ready for automatic staging deploys on pushes to `main`. Leave it unset during setup. No registry token is needed; Docker builds happen on the VPS. Application DB/auth/Resend credentials belong in the Environment secrets listed above, never repository files or plain Variables.

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

The `VPS_KNOWN_HOSTS is unset` line is a warning. Workflow errors name the failing stage. Missing GitHub settings name the fields before SSH; an absent server `.env` is handled by automatic initialization. Directory or authentication errors retain SSH diagnostics without printing file contents. Remote build/migration failures print the phase and protected server log path. Logs are not automatically copied to GitHub; review privately and redact before sharing. Never enable shell tracing or print resolved Compose/container environments.

An application-only rollback is manual and requires a confirmed compatible schema: select a retained previous release directory/tag, export its `SITEPULSE_RELEASE` and the environment's `WEB_BIND_PORT`, then run `docker compose -p sitepulse-staging --env-file /opt/sitepulse-staging/shared/.env -f <previous-release>/docker-compose.yml up --no-build --no-deps -d --wait sitepulse-api sitepulse-worker sitepulse-web`. Verify HTTPS and authentication before marking recovery complete. Do not rerun migrations from an old release or restore a database automatically. For incompatible migrations, use a reviewed forward fix or the authorized isolated-database restoration/cutover described in [DEPLOYMENT.md](DEPLOYMENT.md). Restoring a dump can lose subsequent writes.

The workflow permits one in-flight deployment per environment, and the server lock rejects concurrent manual deploys. Avoid dispatching an older workflow run after a newer deployment; doing so is an intentional version change and needs schema review. Keep disk usage under observation; remove retained releases/images/backups only under a reviewed retention policy. Never run `docker compose down -v` on these projects.
