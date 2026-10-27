# SitePulse

## 通知设置与收件人管理

侧栏 **Notifications** → 选择工作区，可管理故障和恢复的邮件与 Bark 推送。已验证的工作区 owner/admin 可添加多个邮箱或 Bark 设备、重发验证、启停、删除、发送测试通知，以及关闭/开启成员自动接收邮件；其他成员只读。平台管理员身份不绕过工作区权限。

- 默认保留已验证成员自动接收。独立邮箱必须点击验证邮件中的链接，并在页面确认后才可接收；不需要注册 SitePulse，也不获得工作区访问权。
- 每个工作区最多 20 个有效收件人（邮箱和 Bark 设备合计），邮箱不区分大小写，同一事件同一收件人仅投递一次。托管邮箱覆盖同地址的成员自动接收，待验证、停用或删除后不会回退到成员投递；需要恢复时重新添加并验证。
- 验证链接一小时有效、单次使用，重发使旧链接失效。验证与测试共用每个收件人 60 秒冷却、每工作区每小时 10 次额度。创建时即发送验证；发送失败仍保留收件人，可稍后重发。
- 测试仅允许已验证且启用的收件人，成功表示服务商接受，不代表邮件到达或手机展示。故障与恢复使用持久化队列；验证和测试同步交给服务商，不自动重试。
- 停用、删除、关闭成员自动接收和撤销成员资格会抑制对应的待投递告警；已在发送中或服务商已接受的邮件不能撤回。新增收件人不补发历史告警。

本地继续使用 `AUTH_MAIL_TRANSPORT=file`，验证/测试邮件查看 `.local/mail`，监控邮件查看 `.local/alert-mail`；不要分享包含验证链接的文件。启用 Bark 时设置稳定的 `BARK_ENCRYPTION_KEY`，它用于加密数据库中的设备 Key，API 和 worker 必须使用相同值。正常部署需先备份再应用迁移 `0009_melted_jigsaw`，本任务不执行生产迁移或部署。

Bark App 中复制设备 Key，在通知页填写设备名称和 Key。收到验证推送后点击通知，再在公开确认页明确确认；该证明不授予账号或工作区权限。首版固定使用官方 `api.day.app`，不接受完整 URL 或自建 Bark 服务。验收：分别添加两个设备并确认 → 冷却后发送测试 → 在受控测试站点触发故障/恢复 → 检查每台设备各一条 → 停用后确认不再投递。详见 [通知说明](docs/NOTIFICATIONS.md)。

## Platform administration

平台管理后台位于 `/app/admin`，支持按工作区名称、slug 或 UUID 搜索、查看套餐与用量、修改套餐或自定义站点额度，并填写必填原因。编辑后先点击 **Preview impact** 查看前后额度及新增限制，再 **Confirm and save**。保存会记录真实管理员用户 ID、原因和前后值；工作区 owner/admin 可在现有审计记录中查看。预览后套餐或用量发生变化，保存会返回冲突，需重新预览。

首次启用步骤：

1. 用准备作为平台管理员的账号登录并完成邮箱验证。在同一浏览器访问 `/api/v1/auth/session`，复制返回的 `user.id`（UUID）。不要复制 Cookie 或会话令牌。
2. 本地：在未提交的根目录 `.env` 中设置 `PLATFORM_ADMIN_USER_IDS=<user.id>`，然后重启 API；Docker 开发环境需重新创建 API 容器。多管理员用英文逗号分隔 UUID。
3. GitHub Actions：在部署工作流使用的 GitHub Environment → Variables 中添加 `PLATFORM_ADMIN_USER_IDS`，值同上，再通过正常流程部署。无需在 VPS 上手动修改数据库或配置。
4. 刷新页面，侧栏会出现 **Platform admin**。普通组织 owner/admin 直接请求管理 API 也会被拒绝。

变量默认留空，表示无人具有平台管理权限；非法 UUID 会阻止配置校验。API 每个请求都结合 Better Auth 会话及邮箱验证状态检查。移除 UUID 后重启/重新部署 API 即撤销权限。首次注册者、组织 owner、邮箱地址均不会自动获得平台权限。平台权限仅用于工作区套餐与额度管理，不授权读取其他租户站点、凭据或监控详情。不要在原因中填写密钥或敏感客户信息。

本里程碑无需数据库迁移，未执行线上权限或套餐变更。正式授权及部署由维护者确认。CLI 仍可用于受控运维，详见 [套餐与额度](docs/ENTITLEMENTS.md)。

## UI design

Incident directories and site incident history pair graphical signals with visible UP / DOWN labels for HTTP incidents, plus the existing lifecycle status. UP means confirmed recovery in that historical incident, not current site availability. SSL incidents use certificate labels; connection resets show Closed with recovery unverified.

Authenticated page transitions use shared, route-specific skeleton screens for the overview, directories, workspace cards, details and forms. The sidebar and top bar stay in place. Placeholders are non-interactive, announce loading to screen readers and stop pulsing when reduced motion is preferred.

All public, authentication and workspace pages follow [DESIGN.md](DESIGN.md). Shared design tokens live in `apps/web/app/globals.css`; follow [UI implementation guidelines](docs/UI_GUIDELINES.md) for future UI changes. The product uses readable system sans-serif typography, SVG navigation/status icons, blue primary actions and rounded white cards on a light background. The overview includes a connector distribution donut with textual counts, actionable attention items and site cards with direct Monitoring / Inventory / Connection links. Charts use authorized site data, not illustrative trends; connector activity does not imply HTTP availability. Public marketing retains the original cream/monospace reference. No commercial font is bundled or downloaded.

Interactive controls use stronger outlines, bold button labels and 44px minimum heights. Active navigation uses bold blue text/icons on a light blue background, without notification-like dots; inline links remain underlined and card actions have outlined touch targets. Operational badges distinguish healthy, warning and critical states with readable semantic colors, icons and text. Errors and feedback appear in bordered tinted panels; quota and verification warnings are highlighted separately. Connector failures are announced as errors, and destructive actions retain confirmation dialogs.

SitePulse is a multi-tenant workspace for WordPress maintenance providers. Accounts, password recovery, email verification, organizations, isolated sites, WordPress connector pairing, revocable credentials, heartbeat freshness, minimized inventory, external HTTP/SSL checks, incidents, and deduplicated email/Bark incident and recovery alerts are implemented. Billing and additional notification channels remain separate milestones.

## Workspace navigation

The signed-in workspace uses a persistent sidebar: **Overview**, **Sites**, **Incidents**, and **Workspaces**. `/app/sites` lists sites across your authorized organizations, with name/hostname search, workspace filtering, connector status, recent unresolved incidents, and direct Monitoring / Inventory / Connection links. `/app/sites/new` lets verified owners/admins select a workspace and opens pairing after creation. `/app/incidents` provides status/workspace filters and acknowledgement for verified owners/admins.

Site sections are directly addressable at `/app/sites/<id>?view=monitoring`, `?view=inventory`, and `?view=connection`. Navigation adapts to small screens, and Refresh data reloads current server data. All reads and mutations retain API membership checks; UI filters do not grant access. Overview connector statistics describe heartbeat activity, not HTTP uptime. Lists include up to 1,000 sites and the latest 100 incidents per organization; unresolved counts apply to that recent history. The interface does not auto-poll.

## HTTP / SSL monitoring

Paired sites are monitored by the worker independently of connector heartbeats. Site details show HTTP availability, latency, certificate expiry, recent checks and incidents; organization pages list recent incidents. Verified owners/admins can acknowledge an incident. Two consecutive failures open an incident; two successes recover it. Disconnecting, rotating or re-pairing closes existing incidents with `connection_reset`, which does not assert recovery.

Only public HTTP(S) destinations on standard ports are allowed. Every connection and redirect resolves and validates all addresses, pins an approved address and verifies TLS. Each probe has a 10-second total budget, at most three redirects, and a 16 KiB header limit; response bodies are discarded. HTTPS downgrade is rejected. HTTP 200–399 is healthy after redirect processing; 4xx/5xx (including WAF blocks) count as failures. SSL checks validate the original HTTPS hostname and flag expiry at 14/7/3 days. HTTP-only sites have no SSL job.

Optional validated settings in `.env` or GitHub Environment Variables: `MONITORING_ENABLED=true`, `MONITOR_INTERVAL_SECONDS=300` (60–3600 seconds, 1–60 minutes), `SSL_INTERVAL_SECONDS=86400` (3600–604800). This is an operator-controlled global HTTP interval, not a tenant-supplied plan or permission. Existing GitHub Environment overrides remain effective: set `MONITOR_INTERVAL_SECONDS` to `300` or remove the old `900` override, then redeploy. Shorter intervals also tighten existing unleased healthy HTTP jobs in bounded batches. Set `MONITORING_ENABLED=false` and restart/redeploy to pause external probes; stored status/history remains visible. The worker needs outbound DNS and public HTTP/HTTPS access. PostgreSQL remains private and no worker port is published.

The first failed HTTP/SSL check displays **First failure — awaiting confirmation** without sending mail. A second failure, scheduled 60 seconds later, confirms the incident; repeated failures do not send duplicate opening alerts. Recovery requires two consecutive successful checks, also with a 60-second confirmation delay. At the default 5-minute interval, detection is nominally up to 5 minutes plus 1 minute for confirmation, **plus worker polling, probe runtime, queue lag and mail-provider delays**; this is not instant monitoring or a delivery SLA. For 1-minute checks, consider `WORKER_POLL_SECONDS=10`; the loop waits after each sweep and is not a fixed-rate timer.

Connector freshness is separate: WordPress still sends heartbeats every 15 minutes. After `HEARTBEAT_STALE_SECONDS` (default `2700`, 45 minutes; allowed 1800–86400), the worker opens one warning `stale_data` incident per loss episode and notifies eligible workspace recipients. A valid, non-replayed heartbeat resolves it and queues one recovery event. This does **not** assert website downtime or HTTP recovery. Already-degraded paired sites are included after upgrade. Disconnect/rotation/re-pairing closes incidents without claiming recovery. Heartbeat expiration and queued-mail delivery continue when external probes are disabled.

Migration `0008_flippant_shiver_man` permits Connector incidents. The normal deployment must back up before applying it; no production changes were performed during implementation. Follow [responsiveness acceptance](docs/MONITORING_RESPONSIVENESS.md) after deployment.

Migrations `0003_external_monitoring`, `0004_cold_zemo`, `0005_strange_nocturne`, `0007_neat_morlun` and `0009_melted_jigsaw` add monitoring jobs, checks, incidents, the durable notification outbox with stale-worker fencing, workspace notification settings, verified recipients and channel metadata. Deployment backs up before applying registered migrations. Checks are retained for 30 days and resolved incidents for 90 days, with bounded cleanup. A worker claims at most four probe jobs plus five email and five Bark deliveries per poll (default 60 seconds); retry timestamps are due times, not delivery guarantees. Alerts use the workspace's verified, enabled recipient policy. Validate capacity before scaling beyond a small pilot. See [monitoring acceptance](docs/MONITORING_ACCEPTANCE.md) and [notification delivery](docs/NOTIFICATIONS.md).

## Plans and site allowances

Free / Pro / Agency / Agency Plus allow 2 / 10 / 30 / 100 sites by default. All non-deleted sites count, including pending/disconnected sites. The API enforces quotas during concurrent creation and restoration. Downgrades keep existing sites and monitoring running. Workspaces and Add a site display plan usage and quota messages.

Operators can assign a plan or override an allowance (root `.env` required for host use):

```sh
pnpm entitlements:set --organization <organization-uuid> --plan pro --site-limit default --operator ops --reason "Pilot allocation"
```

Use a number from 0–1000 instead of `default` for a custom allowance. All flags are required and changes are audited. No payment integration is included. See [operator commands, container usage and quota rules](docs/ENTITLEMENTS.md). Production changes need explicit authorization; this implementation does not change VPS data.

## Authentication email

The homepage shows an Open workspace button for authenticated users. Visiting `/login` or `/register` with a valid session redirects to `/app`. Session checks run on the server without caching; expired or revoked sessions show the normal login and registration pages.

Host development defaults to `AUTH_MAIL_TRANSPORT=file`: open the JSON messages in `.local/mail` and follow the link. This directory contains sensitive links; it is ignored by Git and Docker and must never be shared. Registration sends a verification email. `/verify-email` also resends it. `/forgot-password` requests recovery and `/reset-password` confirms a new password. Links use URL fragments, are removed from browser history on load, and require a user action before submitting. Reset links expire after 30 minutes and are single-use; verification links expire after one hour and repeat confirmation is idempotent. Resetting a password revokes all existing sessions.

Production requires `AUTH_MAIL_TRANSPORT=resend`, `AUTH_MAIL_FROM` set to a verified sender email, and `RESEND_API_KEY` injected privately. File transport is refused in production. No real provider messages are sent by tests. Delivery failures produce a sanitized audit event; public request responses remain generic. Automatic delivery retries and a durable email queue are deferred; users can request a new email after correcting provider configuration. Authentication mail is separate from future monitoring alerts.

The complete supplied specification is preserved in [docs/PRODUCT_SPECIFICATION.md](docs/PRODUCT_SPECIFICATION.md). Architecture decisions and deliberate milestone limits are in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Requirements

- Node.js 22.18+ (Node 22 recommended), Corepack, pnpm 10.32.1.
- Docker Engine with Compose v2, or a separately managed PostgreSQL database for host development.
- PHP 8.1+ for plugin syntax/contract tests; WordPress 6.5+ single-site for live plugin acceptance.
- OpenSSL for ephemeral TLS test certificates; Git for Windows includes a compatible executable. Set `OPENSSL_BIN` if needed.
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

For GitHub Actions deployment to a Linux VPS, follow [the setup guide](docs/GITHUB_ACTIONS_VPS.md). Configure application secrets and variables in GitHub Environments; Actions automatically creates directories and installs private configuration over SSH, including the first deployment. CI can deploy `main` to staging after checks; production requires manual confirmation. Encrypted pre-migration backups, release-tagged images and HTTPS health verification are included. Optional SSH host-key discovery does not independently verify server identity. Docker/Compose, working SSH access, DNS/TLS routing and real authentication mail are infrastructure prerequisites.

Use only `docker-compose.yml`. Set `APP_ORIGIN` to the external **HTTPS** origin and supply independent production secrets through a secrets manager or protected deployment environment. The API rejects non-HTTPS origins in production. PostgreSQL has no published port and uses a private Docker network. API is internal; web publishes `127.0.0.1:3000` for a host HTTPS reverse proxy. Configure the proxy to preserve browser `Origin`, reject unknown hosts, terminate TLS, and forward requests to that loopback port.

See [deployment and rollback](docs/DEPLOYMENT.md) and [security limits](docs/SECURITY.md). The initial stack is single-instance; do not scale it without shared authentication throttling and a trusted proxy/client-IP design. This milestone is not ready for a public paid launch.

## GitHub Actions 自动部署到 VPS

部署流程为：CI 检查通过 → SSH 上传对应提交 → VPS 构建 Docker 镜像 → 暂停应用写入并加密备份数据库 → 执行迁移 → 启动容器 → 检查内部及公网 HTTPS 健康状态。Docker 镜像在 VPS 构建，无需配置镜像仓库账号。迁移和重启期间会短暂停机。

### 1. 自动初始化 VPS

使用已有 Docker Engine、Docker Compose v2、Bash 和可用 SSH 登录的 Linux VPS。你当前使用 root，可直接在 GitHub 配置，不需要先登录 VPS 创建目录、编辑 `.env` 或安装 `age`。Debian/Ubuntu 的 root 部署会自动安装缺少的 `age`、`curl`、`flock` 辅助工具；已有 Docker 和其他容器不会被重装或清理。其他系统需预装这些工具。

使用已经能够登录该账户的 SSH 私钥，存入下文的 GitHub Secret；私钥需要支持非交互认证。账户需要足够磁盘和内存完成构建。不要把私钥、密码或 `.env` 提交到仓库。

工作流会通过 SSH 自动创建 `/opt/sitepulse-staging` 及 `incoming`、`releases`、`shared`、`backups`、`logs` 子目录。使用 root 部署时无需手工创建；新目录权限为 `700`，已有目录的权限、所有者和文件保持不变。重复运行不会清空目录。Production 自动创建对应的 `/opt/sitepulse-production` 目录。

工作流从 GitHub 配置自动生成并通过 SSH 标准输入传输 `shared/.env`、`shared/backup-recipient.txt` 和 `shared/public-origin.txt`，文件权限为 `600`。密钥不会进入源码压缩包、Docker 构建目录或 Actions artifact，日志不打印密钥。每次部署以 GitHub 配置为准；数据库用户、库名或密码与已有配置不一致时会停止，防止误以为修改 `.env` 就能轮换数据库凭据。普通账户仍须具有目标目录和 Docker 的操作权限。

在自己的可信电脑分别运行两次下列命令，生成独立的数据库密码和认证密钥，粘贴到 GitHub Secrets，后续部署保持不变：

```sh
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
```

如需启用 Bark，再生成一个独立且稳定的 32 字节十六进制加密密钥，保存为 GitHub Environment Secret `BARK_ENCRYPTION_KEY`：

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

不要在每次部署时重新生成。丢失或替换此值会使已保存的 Bark 设备 Key 无法解密；应恢复旧值，或删除并重新添加设备。它不是 Bark 设备 Key，两者不要混用。

在自己的电脑使用 `age-keygen -o sitepulse-backup.key` 生成备份密钥，只把输出的 `age1…` 公钥填入 GitHub Variable `BACKUP_AGE_RECIPIENT`。私钥保存在 VPS 和 GitHub 之外，用于恢复备份。无需在 VPS 上运行此命令。异地备份与恢复演练见[完整部署指南](docs/GITHUB_ACTIONS_VPS.md)。

### 2. 配置域名与 HTTPS

将域名解析到 VPS，通过宿主机上的 Nginx、Caddy 或 1Panel HTTPS 反向代理转发到 `127.0.0.1:3000`。可参考 [Caddy 配置模板](deploy/Caddyfile.example)。代理应保留浏览器的 `Origin`，拒绝未知主机名，并限制请求大小和超时。

端口可在 GitHub **Settings → Environments → staging → Environment variables** 中配置：新增变量 `WEB_BIND_PORT`，例如 `18080`，代理上游改为 `127.0.0.1:18080`。Production 在自己的 Environment 中单独设置。有效范围为 `1–65535`，请选择 VPS 上未被占用的端口。未设置时 staging 默认 `3000`，production 默认 `3001`。这是宿主机端口，容器内部仍为 `3000`；`VPS_PORT` 只控制 SSH 端口。此变量填在 **Variables**，不是 Secrets；部署时优先于 VPS `.env` 中同名项，绑定地址仍为 `127.0.0.1`。

只对外开放 SSH 和 HTTPS 所需端口；不要公开 PostgreSQL 或 API 端口，不要使用 `docker-compose.dev.yml` 部署 staging 或 production。如果代理运行在容器中，需要另外配置其到宿主机回环服务的访问方式，详见完整指南。

### 3. 在 GitHub 后台保存 VPS 信息和密钥

进入仓库 **Settings → Environments → New environment**，创建名称完全一致的 `staging` 环境，在 **Environment secrets** 中添加：

| Secret 名称           | 填写内容                                                                                 |
| --------------------- | ---------------------------------------------------------------------------------------- |
| `VPS_HOST`            | VPS 主机名或 IPv4 公网地址，不加协议、路径或端口；当前工作流不支持 IPv6 字面地址         |
| `VPS_PORT`            | SSH 端口，例如 `22`；未设置时默认 `22`                                                   |
| `VPS_USER`            | 已配置部署公钥且有 Docker 操作权限的 SSH 用户                                            |
| `VPS_SSH_KEY`         | 完整 OpenSSH 私钥，包含首尾标记和原始换行                                                |
| `VPS_KNOWN_HOSTS`     | 可选：已核验的 VPS SSH 主机公钥记录；不配置时自动扫描；非默认端口使用 `[host]:port` 形式 |
| `POSTGRES_PASSWORD`   | 至少 32 位随机 base64url 或十六进制数据库密码，保持稳定                                  |
| `BETTER_AUTH_SECRET`  | 独立随机认证密钥，至少 32 位，保持稳定                                                   |
| `RESEND_API_KEY`      | 真实 Resend API key                                                                      |
| `BARK_ENCRYPTION_KEY` | 可选；64 位十六进制加密密钥。启用 Bark 时必须配置并保持稳定                              |

在同一个环境的 **Environment variables** 添加：

| Variable 名称                  | 填写内容                                                                          |
| ------------------------------ | --------------------------------------------------------------------------------- |
| `APP_ORIGIN`                   | 真实 HTTPS origin，例如 `https://pulse.your-domain.com`，不带路径、端口或末尾斜杠 |
| `AUTH_MAIL_FROM`               | Resend 已验证域名下的发件邮箱                                                     |
| `BACKUP_AGE_RECIPIENT`         | 备份加密公钥 `age1…`，不能填私钥                                                  |
| `WEB_BIND_PORT`                | VPS 未占用端口，例如 `18080`；staging 默认 3000，production 默认 3001             |
| `POSTGRES_USER`、`POSTGRES_DB` | 可选，均默认 `sitepulse`，只支持小写字母、数字、下划线，不能数字开头              |

部署固定启用 production 运行模式及 Resend 邮件，不接受本地 file 邮件模式。更换认证密钥会影响已有会话；不要每次发布生成新密钥。已有服务器配置需将相同凭据迁入 GitHub，而不是重新生成数据库密码。

#### 如何生成或获取这些配置（Windows）

以下操作都在自己的电脑或服务商后台完成，无需登录 VPS。先打开 GitHub **Settings → Environments → staging**；本次部署选 `production` 时，填写对应的 `production` 环境。Secrets 使用 **Add environment secret**，Variables 使用 **Add environment variable**。名称必须与上表完全一致，不能把所有字段都放入 Secrets；当前工作流分别从 `secrets` 和 `vars` 读取。

**`POSTGRES_PASSWORD` 和 `BETTER_AUTH_SECRET`：分别生成。** 在 Windows PowerShell 执行：

```powershell
# 生成数据库密码并复制到剪贴板，立即粘贴到 POSTGRES_PASSWORD Secret。
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))" | Set-Clipboard
```

保存第一个 Secret 后，再执行一次以生成不同的认证密钥：

```powershell
# 生成独立认证密钥，立即粘贴到 BETTER_AUTH_SECRET Secret。
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))" | Set-Clipboard
```

命令要求本机已安装 Node.js；它们不会将密钥输出到终端或写入仓库。两个值不要相同，后续发布不要重新生成。若服务器已有数据库，必须沿用已有数据库密码。粘贴后可用 `Set-Clipboard -Value ''` 清空当前剪贴板；启用剪贴板历史或同步时也应自行清理。

**`RESEND_API_KEY` 和 `AUTH_MAIL_FROM`：从 Resend 配置获得。** 登录 Resend 后，在 **Domains** 添加自己拥有的发件域名，按页面要求在域名 DNS 服务商添加验证记录，等待验证通过。在 **API Keys → Create API Key** 创建专用 key，选择 **Sending access** 并限制到该发件域名，将完整 key 保存为 `RESEND_API_KEY` Secret。key 是服务商签发的，不能用随机字符串代替。

`AUTH_MAIL_FROM` 填该已验证域名下的邮箱地址，例如发件域名为 `mail.your-domain.com` 时可填 `no-reply@mail.your-domain.com`。这里只填邮箱，不要填写 `SitePulse <no-reply@...>` 这样的显示名称格式。将它保存为 Variable；网站域名与发件域名可以不同，但发件域名必须完成 Resend 验证。官方说明见 [Resend API key 管理](https://resend.com/docs/dashboard/api-keys/introduction)与[发件域名验证](https://resend.com/docs/dashboard/domains/introduction)。

**`BACKUP_AGE_RECIPIENT`：生成备份密钥后提取公钥。** 在 Windows PowerShell 安装官方 age 工具：

```powershell
winget install --id FiloSottile.age --exact
```

安装后重新打开 PowerShell，在仓库之外保存备份私钥，再复制公钥：

```powershell
$sitepulseBackupDirectory = Join-Path $env:LOCALAPPDATA 'SitePulse\backup-keys'
New-Item -ItemType Directory -Path $sitepulseBackupDirectory -Force | Out-Null
$sitepulseBackupKey = Join-Path $sitepulseBackupDirectory 'staging-backup.key'
age-keygen -o "$sitepulseBackupKey"
age-keygen -y "$sitepulseBackupKey" | Set-Clipboard
```

将剪贴板中的完整 `age1…` 公钥粘贴为 `BACKUP_AGE_RECIPIENT` Variable。只复制公钥，不能复制 `AGE-SECRET-KEY-…` 私钥或整个 `.key` 文件。这里使用默认传统 age 密钥，不要加 `-pq`，当前部署仅接受 `age1…` 格式。已有私钥时只运行 `age-keygen -y` 提取公钥即可；不要重新生成或覆盖。Production 使用另一文件名如 `production-backup.key`。将私钥另行安全备份，恢复数据库时需要它；不要上传至 GitHub、VPS 或提交到仓库。安装与命令参考 [age 官方说明](https://github.com/FiloSottile/age#installation)。

**其余 Variables：选择实际配置，不需要随机生成。**

| 名称                           | 如何确定                                                                                                                                                                                                |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `APP_ORIGIN`                   | 填准备访问 SitePulse 的真实 HTTPS 网站地址，例如 `https://pulse.your-domain.com`；域名解析到 VPS，HTTPS 代理指向所选应用端口。不填 VPS 内网地址，也不加 `/`、路径或端口。示例域名需要替换为自己的域名。 |
| `WEB_BIND_PORT`                | 根据 VPS 面板已有容器的端口映射选择未占用宿主机端口，例如 `18080`，HTTPS 代理上游同步填 `127.0.0.1:18080`；不能仅凭示例假定端口空闲。                                                                   |
| `POSTGRES_USER`、`POSTGRES_DB` | 首次部署通常都不创建，工作流默认使用 `sitepulse`；自定义时填固定名称，不能用邮箱或连接字符串。                                                                                                          |
| `AUTO_DEPLOY_STAGING`          | 希望推送 `main` 后自动部署时，按下节在 **Repository variables** 添加并填 `true`；它不放在 Environment secrets 中。                                                                                      |

`VPS_HOST`、`VPS_PORT`、`VPS_USER` 从 VPS 服务商或面板已有 SSH 登录信息获得；当前 root 用户填 `root`。`VPS_SSH_KEY` 使用已经能登录这台 VPS 的完整私钥，不能只在本机新生成一个未获服务器授权的密钥就填入。`VPS_KNOWN_HOSTS` 可省略。

若仍出现 `Invalid deployment variables`，先检查报错字段是否为空、Secrets/Variables 分类是否正确、是否填在本次选择的环境中。报错可能重复列出同一字段，因为它同时违反了多条校验，并不代表需要创建多个同名配置。

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

Production 使用独立 GitHub Environment `production`、独立应用密钥和服务器目录 `/opt/sitepulse-production`，默认上游为 `127.0.0.1:3001`。在该 Environment 填写对应的 Secrets、Variables 并设置域名代理即可；目录及配置文件由 Actions 自动创建。支持部署审批的 GitHub 套餐可额外配置 required reviewers，并将部署分支限制为 `main`。

Production 不会随推送自动部署。需要手动运行 **SitePulse checks**，选择 `production` 并勾选 `confirm_production`，授权本次部署及数据库迁移。

每次部署前的加密备份保存在 VPS 的 `backups` 目录。当前流程尚未自动上传异地备份或执行恢复演练，正式使用前需要配置。备份、迁移或启动验证失败时，应用会保持停止，等待检查和人工恢复；不会自动回退数据库。请按[完整部署指南](docs/GITHUB_ACTIONS_VPS.md)查看日志、状态和回滚步骤，不要对部署项目运行 `docker compose down -v`。

如果 Actions 显示 `VPS_KNOWN_HOSTS is unset`，该行只是警告。缺少 GitHub 应用配置会在连接 VPS 前显示对应字段名；不再要求手动创建服务器 `.env`。构建后的详细诊断保存在 VPS 的 `logs/<release>.log`，请私下查看，不要公开原始日志或 `.env`。现有 HTTPS 代理与 DNS 仍需指向所选上游端口；工作流不会改写 VPS 上其他站点的代理配置。

如果部署日志出现 `curl: (**) ... 525`，说明应用已构建并完成迁移，但公网 HTTPS 反向代理的 TLS 握手失败。确认 `APP_ORIGIN` 对应的域名解析到 VPS，Cloudflare 使用 `Full (strict)`，源站证书已安装在 443 反向代理，且代理使用 **HTTP** 转发到 `127.0.0.1:WEB_BIND_PORT`（例如 `http://127.0.0.1:18080`），不要把容器上游写成 HTTPS，也不要继续使用旧的 3000 端口。修复代理后重新运行同一个 staging workflow；失败验证会让应用保持停止，这是为了避免未经公网验证的版本继续运行。

## Repository map

| Location                      | Responsibility                                                                                   |
| ----------------------------- | ------------------------------------------------------------------------------------------------ |
| `apps/web`                    | Next.js, React, Tailwind, accessible Radix form labels; login, registration, protected workspace |
| `apps/api`                    | Fastify REST API, Better Auth bridge, authorization, integration tests                           |
| `apps/worker`                 | Heartbeat expiration, SSRF-safe HTTP/SSL probes, leased PostgreSQL jobs and incident transitions |
| `packages/database`           | Drizzle schema, SQL migrations, PostgreSQL connection/migration helpers                          |
| `packages/api-contracts`      | Shared strict Zod request contracts and public types                                             |
| `packages/config`             | Validated server environment variables                                                           |
| `packages/shared`             | Shared role policy                                                                               |
| `plugins/sitepulse-connector` | Installable single-site WordPress pairing/heartbeat plugin and PHP contract checks               |
| `docs`                        | Full specification, architecture, API, security, deployment and milestone tracking               |

Next task: run the [staging email acceptance procedure](docs/NOTIFICATION_ACCEPTANCE.md), including provider handoff, actual mailbox receipt, duplicate suppression, retry behavior and no cross-tenant recipients. It includes GitHub configuration, scoped read-only SQL and an evidence template. Do not deploy production migrations without an explicit release authorization and verified backup.

Current evidence and outstanding staging access requirements are recorded in the [notification acceptance report](docs/NOTIFICATION_ACCEPTANCE_REPORT.md); local verification does not establish live email delivery.

The owner has confirmed production UI verification. Earlier HTTPS staging login, site creation, connector pairing and inventory acceptance are documented in [the acceptance procedure](docs/CONNECTOR_ACCEPTANCE.md).

Inventory requires migration `0002_minimal_inventory`. Commit SQL migrations together with `packages/database/migrations/meta/_journal.json` and their snapshots: Drizzle runs only journal entries. CI checks migration registration and exercises inventory reads/writes on a disposable database. Deployment applies registered migrations automatically before starting the application.
