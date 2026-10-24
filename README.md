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

For GitHub Actions deployment to a Linux VPS, follow [the setup guide](docs/GITHUB_ACTIONS_VPS.md). CI can automatically deploy `main` to staging after checks; production requires a manual confirmation and supports GitHub environment approval rules. The workflow supports optional pinned SSH host keys, server-only application secrets, encrypted pre-migration backups, release-tagged images and HTTPS health verification. If no host-key record is configured, it discovers and trusts the server key on each run without independently verifying server identity. Configure VPS, DNS/TLS, real authentication mail and GitHub environment secrets before enabling it.

Use only `docker-compose.yml`. Set `APP_ORIGIN` to the external **HTTPS** origin and supply independent production secrets through a secrets manager or protected deployment environment. The API rejects non-HTTPS origins in production. PostgreSQL has no published port and uses a private Docker network. API is internal; web publishes `127.0.0.1:3000` for a host HTTPS reverse proxy. Configure the proxy to preserve browser `Origin`, reject unknown hosts, terminate TLS, and forward requests to that loopback port.

See [deployment and rollback](docs/DEPLOYMENT.md) and [security limits](docs/SECURITY.md). The initial stack is single-instance; do not scale it without shared authentication throttling and a trusted proxy/client-IP design. This milestone is not ready for a public paid launch.

## GitHub Actions 自动部署到 VPS

部署流程为：CI 检查通过 → SSH 上传对应提交 → VPS 构建 Docker 镜像 → 暂停应用写入并加密备份数据库 → 执行迁移 → 启动容器 → 检查内部及公网 HTTPS 健康状态。Docker 镜像在 VPS 构建，无需配置镜像仓库账号。迁移和重启期间会短暂停机。

### 1. 首次准备 VPS

准备 Linux VPS，安装 Docker Engine、Docker Compose v2、Bash、`curl`、`flock` 和 `age`，并配置有 Docker 操作权限的专用 SSH 部署账户。该账户需要足够的磁盘和内存完成构建。

将部署 SSH 公钥加入该账户的 `~/.ssh/authorized_keys`。匹配的私钥用于下面的 GitHub Secret；当前工作流需要可非交互使用的专用密钥。不要把私钥、密码或 `.env` 提交到仓库。

以管理员身份建立 staging 目录；以下 `deploy` 用户和组名需要替换为实际部署账户：

```sh
sudo install -d -m 700 -o deploy -g deploy /opt/sitepulse-staging
sudo -u deploy mkdir -p /opt/sitepulse-staging/{incoming,releases,shared,backups,logs}
```

通过安全方式将 [deploy/vps.env.example](deploy/vps.env.example) 复制为 `/opt/sitepulse-staging/shared/.env`，设置权限为 `600`，填写：

- `APP_ORIGIN`：真实公网 HTTPS origin，不带路径或末尾斜杠。
- `POSTGRES_USER`、`POSTGRES_DB`、`POSTGRES_PASSWORD`：独立的数据库配置。
- `BETTER_AUTH_SECRET`：独立随机密钥，后续发布保持不变。
- `AUTH_MAIL_TRANSPORT=resend`、`AUTH_MAIL_FROM`、`RESEND_API_KEY`：真实邮件服务配置，发件域名需要完成验证。

可分别运行两次 `openssl rand -hex 48`，生成数据库密码和认证密钥，在服务器上私下保存。不要复用 Windows 本地凭据。数据库密码、认证密钥和邮件服务密钥保留在 VPS，当前工作流不会从 GitHub 注入这些应用配置。

在可信管理员电脑生成 age 备份密钥，将私钥保存在 VPS 之外。服务器还必须准备以下两个文件，均设置权限为 `600`：

| 文件                                                 | 内容                                                |
| ---------------------------------------------------- | --------------------------------------------------- |
| `/opt/sitepulse-staging/shared/backup-recipient.txt` | 一行 age 备份加密公钥，格式为 `age1…`               |
| `/opt/sitepulse-staging/shared/public-origin.txt`    | 一行公网 HTTPS origin，必须与 `APP_ORIGIN` 完全一致 |

备份密钥生成、异地备份与恢复演练步骤见[完整部署指南](docs/GITHUB_ACTIONS_VPS.md)。

### 2. 配置域名与 HTTPS

将域名解析到 VPS，通过宿主机上的 Nginx、Caddy 或 1Panel HTTPS 反向代理转发到 `127.0.0.1:3000`。可参考 [Caddy 配置模板](deploy/Caddyfile.example)。代理应保留浏览器的 `Origin`，拒绝未知主机名，并限制请求大小和超时。

端口可在 GitHub **Settings → Environments → staging → Environment variables** 中配置：新增变量 `WEB_BIND_PORT`，例如 `18080`，代理上游改为 `127.0.0.1:18080`。Production 在自己的 Environment 中单独设置。有效范围为 `1–65535`，请选择 VPS 上未被占用的端口。未设置时 staging 默认 `3000`，production 默认 `3001`。这是宿主机端口，容器内部仍为 `3000`；`VPS_PORT` 只控制 SSH 端口。此变量填在 **Variables**，不是 Secrets；部署时优先于 VPS `.env` 中同名项，绑定地址仍为 `127.0.0.1`。

只对外开放 SSH 和 HTTPS 所需端口；不要公开 PostgreSQL 或 API 端口，不要使用 `docker-compose.dev.yml` 部署 staging 或 production。如果代理运行在容器中，需要另外配置其到宿主机回环服务的访问方式，详见完整指南。

### 3. 在 GitHub 后台保存 VPS 信息和密钥

进入仓库 **Settings → Environments → New environment**，创建名称完全一致的 `staging` 环境，在 **Environment secrets** 中添加：

| Secret 名称       | 填写内容                                                                                 |
| ----------------- | ---------------------------------------------------------------------------------------- |
| `VPS_HOST`        | VPS 主机名或 IPv4 公网地址，不加协议、路径或端口；当前工作流不支持 IPv6 字面地址         |
| `VPS_PORT`        | SSH 端口，例如 `22`；未设置时默认 `22`                                                   |
| `VPS_USER`        | 已配置部署公钥且有 Docker 操作权限的 SSH 用户                                            |
| `VPS_SSH_KEY`     | 完整 OpenSSH 私钥，包含首尾标记和原始换行                                                |
| `VPS_KNOWN_HOSTS` | 可选：已核验的 VPS SSH 主机公钥记录；不配置时自动扫描；非默认端口使用 `[host]:port` 形式 |

`VPS_KNOWN_HOSTS` 可以不创建：工作流会在每次部署时自动运行 `ssh-keyscan`，扫描失败或结果为空时停止部署，并在日志中提示此模式的限制。SSH 仍使用 `StrictHostKeyChecking=yes`，但自动扫描只保证当前任务内使用同一组密钥，无法独立验证服务器身份，也不会发现不同部署任务之间的主机密钥变化，不能防止扫描阶段的中间人冒充。

如果希望预先核验身份，可设置 `VPS_KNOWN_HOSTS`，工作流会直接使用该记录，不再自动扫描。可以用 `ssh-keyscan -p PORT HOST` 收集记录，通过 VPS 控制台或可信管理员核验主机指纹后保存。`VPS_SSH_KEY` 是部署账户的私钥，与服务器主机公钥不能混用。

### 4. 首次手动部署，再启用自动部署

先将工作流和部署脚本提交并推送到 GitHub 的 `main` 分支。在仓库 **Actions → SitePulse checks → Run workflow** 中选择：

- Branch：`main`。
- environment：`staging`。
- confirm_production：保持未勾选。

检查通过后会执行部署。首次成功后，用 HTTPS 网站验证注册、验证邮件、密码恢复和工作区访问。

确认可用后，进入 **Settings → Secrets and variables → Actions → Variables**，添加一个 **Repository variable**：

```text
名称：AUTO_DEPLOY_STAGING
值：true
```

此后每次推送到 `main`，CI 检查全部通过后就会自动部署到 staging。未设置该变量时，推送只运行检查。Pull request 不会触发部署。建议保护 `main` 并要求检查通过后才能合并。

### 5. Production 与故障处理

Production 使用独立 GitHub Environment `production`、独立应用密钥和服务器目录 `/opt/sitepulse-production`，宿主机上游端口为 `127.0.0.1:3001`。按 staging 相同步骤准备目录和配置文件，并设置对应域名、代理和 SSH Secrets，其中 `VPS_KNOWN_HOSTS` 可选。支持部署审批的 GitHub 套餐可额外配置 required reviewers，并将部署分支限制为 `main`。

Production 不会随推送自动部署。需要手动运行 **SitePulse checks**，选择 `production` 并勾选 `confirm_production`，授权本次部署及数据库迁移。

每次部署前的加密备份保存在 VPS 的 `backups` 目录。当前流程尚未自动上传异地备份或执行恢复演练，正式使用前需要配置。备份、迁移或启动验证失败时，应用会保持停止，等待检查和人工恢复；不会自动回退数据库。请按[完整部署指南](docs/GITHUB_ACTIONS_VPS.md)查看日志、状态和回滚步骤，不要对部署项目运行 `docker compose down -v`。

如果 Actions 只显示 `VPS_KNOWN_HOSTS is unset` 后退出，该行是警告，不能单独确定失败原因。更新后的工作流会显示失败阶段；SSH 连接后的预检查会指出缺失、不可读或不可写的目录/配置文件。首次部署前必须完成以上 VPS 初始化步骤，上传工作流并不会自动生成应用密钥和备份配置。构建后的详细诊断保存在 VPS 的 `logs/<release>.log`，请在服务器上私下查看，不要公开原始日志或 `.env`。

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

Current acceptance status: local Docker image builds, migration-first startup and web/API health checks pass. Live HTTPS WordPress and real email acceptance require staging details; see [the acceptance attempt record](docs/STAGING_ACCEPTANCE_REPORT.md). Inventory remains pending that acceptance.
