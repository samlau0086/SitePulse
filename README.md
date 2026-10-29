# SitePulse

## 站点信息速览

站点目录提供当前搜索/工作区结果的 HTTP 正常、需安全审查、活跃 Connector 数量；三个指标独立计算，不将心跳当作 HTTP 可用性。Monitoring / Security 状态区域可直接进入详情。时间分为日期与时刻，保留秒和当时的 GMT 偏移，区域时区统一显示在列表上方；悬停可查看完整本地时间与 UTC，辅助技术也可读取完整时间。

Plugins & themes 的站点卡片展示已上报的插件、主题、可用更新数量；未收到库存时显示 `—`，不当作零。上次成功采集时间、同步状态和 Sync inventory 按钮保持可见，轮询、请求和尝试时间放在可展开的 Sync details 中。同步失败仍显示原因并保留旧库存；数量仅描述最近已保存的库存。本次界面优化无需数据库迁移或 Connector 升级。

## 邮件品牌与白牌 LOGO

邮件提供带品牌页头、状态说明、操作按钮和备用链接的 HTML 模板，并保留纯文本版本。平台管理员在 **Platform administration → Platform email branding** 设置平台名称和 LOGO；Free/Pro、未设置白牌的 Agency 工作区，以及注册验证/密码重置邮件使用平台品牌。

已验证且拥有 Agency / Agency Plus 工作区的账户，可在 **Preferences → Agency email branding** 保存账户白牌名称与 LOGO。其拥有的 Agency 工作区的告警、收件人验证和测试邮件使用该配置；同账户的 Free/Pro 工作区仍使用平台品牌。清空白牌 LOGO 或工作区降级会回退平台品牌，升级后可继续使用已保存配置。

LOGO 使用公开 HTTPS 图片地址（推荐 PNG/JPEG、360 × 128），由邮件客户端或预览浏览器加载，不由服务端抓取；请使用可信、稳定的图片托管，不要在 URL 中放凭据或令牌。图片被屏蔽时仍显示品牌名称。此配置不改变发件人地址或已验证的发送域名。

部署前需备份并应用新增迁移 `0016_rainy_frog_thor.sql`，然后重启 API、worker 和 web。本次开发不自动修改生产数据库。

安全等级筛选使用浅底卡片，分别展示等级和数量，蓝色边框标明当前筛选。插件与主题页的站点卡片按站点信息、管理就绪状态、采集时间和同步操作分层；单站页面不展示选择框，Connector 配置与轮询说明可展开查看。

## 用户时区

侧栏 **Preferences**（`/app/settings`）可选择 IANA 地区时区（如 `Asia/Shanghai`、`America/New_York`），也可点击 **Use browser time zone** 后保存。设置保存在当前用户账户，跨工作区、设备生效，其他用户不受影响；新旧账户默认 UTC。运维页面的监控、事件、心跳、安全扫描、库存、软件操作、附件和配对有效期统一按所选时区显示，包含 UTC 偏移并自动处理夏令时；悬停时间可查看原始 UTC。

零偏移统一显示为 `GMT`，避免不同运行环境显示为 `GMT+0` 等形式。

部署前需按备份优先流程应用新增迁移 `0015_high_living_mummy.sql`。数据库、API ISO 时间、监控调度和通知投递保持 UTC；此设置只改变界面显示，无需更新 Connector。

## 插件与主题远程管理

侧栏 **Plugins & themes**（`/app/software`）提供插件图标卡片、安装版本/启用/更新状态、站点选择与操作记录；站点详情也有直接入口。已验证的工作区 owner/admin 可以安装、启用、停用、卸载和更新插件/主题，并将同一个操作批量应用到最多 20 个站点。

1. 通过现有备份优先的部署流程应用迁移（包含 `0012_tidy_sir_ram`、`0013_nappy_shinko_yamashiro` 和 `0014_dear_wrecker`），在 WordPress 后台升级 Connector 到 **0.4.0**。仓库源码位于 `plugins/sitepulse-connector/`；旧 ZIP 不会自动包含本次改动，需重新打包该目录。
2. WordPress → **Settings → SitePulse**，勾选 **Enable remote management** 并保存。默认关闭；必须由仍有管理权限的 WordPress 管理员开启。若要安装附件库中的上传包，还需单独勾选 **Allow uploaded package installation**；普通远程管理不会隐式开启此权限。每站独立授权，不需要提供 WordPress 管理员密码。
3. 为 WordPress 配置每分钟执行到期事件的系统 Cron。Connector 每分钟拉取一次指令，受实际 Cron 执行频率影响；原来每 15 分钟的 Cron 会导致最长约 15 分钟等待。等待首次管理轮询及完整 inventory，界面显示 **Management ready**。
4. 选择站点，点击已安装卡片的 **activate / deactivate / update / uninstall**，会直接弹出该组件的确认框，不改变批量表单。检查受影响站点及警告、填写变更原因，服务端预览通过后点击 **Confirm and queue**；取消不会提交执行。安装时在批量面板输入 WordPress.org slug（例如 `wordpress-seo`）。每站结果独立显示；提交前自行完成 WordPress 文件与数据库备份。

确认框在当前视口居中显示，小屏幕四周保留至少 16px；内容过长时在框内滚动。

批量操作：勾选组件前的复选框（可 **Select visible** 全选当前搜索结果），或点击独立的 **Add to bulk →**。右侧 **Bulk operation** 面板显示选中列表，选择统一操作后点击 **Review selected items**，核对每个组件实际影响的站点并统一确认。最多选择 20 个组件、20 个站点；Connector 不可操作，卸载排除启用中的组件，更新只包含有可用更新的官方组件。搜索隐藏的选项仍保留并提示，切换站点或插件/主题类别会清空组件选择。

多组件按顺序提交：上一组件所有目标成功且收到新库存后，才重新校验并提交下一组件。**请保持当前页面打开**；关闭/离开页面或 **Stop remaining items** 仅停止尚未提交的项，不撤销已排队的任务。失败、结果不明、过期、库存变化或权限变化会停止后续提交，不会自动重试，也不是跨组件原子事务。确认后的“Queued”不是已完成，实际执行仍依赖 Connector 轮询及 WordPress Cron。本次交互优化不增加数据库迁移或 Connector 升级要求。

安装来源支持 WordPress.org 官方包，以及工作区 **Attachment library** 中由管理员明确上传、完成静态扫描且未命中阻止规则的 ZIP；不支持任意 URL、付费源或 shell。更新仍只使用 WordPress.org 官方更新路径，不会用上传包覆盖更新。卸载前必须先停用；主题停用需要指定已安装的替代主题，活动主题及父主题受保护。Connector 自身在 WordPress 后台维护。安装/更新可能破坏兼容性，卸载可能删除业务数据；此功能不提供 WordPress 自动备份或回滚。

### 附件库与上传包扫描

侧栏 **Attachment library**（`/app/attachments`）允许已验证的工作区 owner/admin 上传并复用本地插件/主题 ZIP。上传时选择类型和 ZIP 文件；服务端扫描时自动读取 ZIP 唯一顶层目录作为 slug，无需手动填写；每个 ZIP 最大 8 MiB，每个工作区最多 100 个包、原始 ZIP 合计 64 MiB。成员可查看元数据和扫描结果，但不能上传、删除或安装。相同工作区内相同 SHA-256 的包会复用已有记录。

服务端不会解压执行上传代码，而是以受限流式方式检查 ZIP 目录、路径、文件类型、大小、CRC、WordPress header 和部分高风险执行模式；嵌套归档/可执行文件、无效结构或命中规则的包会被阻止安装。**“未命中所选模式”不代表安全、无漏洞或兼容**。包以 base64 形式存入 PostgreSQL，约增加 33% 数据体积并进入数据库备份；当前设计仅适合小规模附件库。安装时没有公开下载 URL，只有对应站点凭据和短期运行任务令牌可以领取包，Connector 会再次校验独立授权、大小和 SHA-256，并始终清理临时文件。

生产反向代理必须允许略高于 8 MiB 的请求：示例 Caddy 已设为 9 MB；1Panel/Nginx 的 SitePulse server/location 设置 `client_max_body_size 9m`。API 仍执行精确的 8 MiB 限制，不要改成无限制。详见 [安全边界、API 与验收步骤](docs/SOFTWARE_MANAGEMENT.md)。

预览 10 分钟有效，待执行任务一小时过期，每站同时只允许一个未完成操作。执行中断/超时显示 **unknown**，不会自动重试；必须检查 WordPress 实际状态后点击 **Reviewed in WordPress**，再决定是否发起新操作。停用管理权限、撤销成员或轮换凭据可阻止未开始任务，无法撤回已经领取执行的变更。详见 [安全边界、API 与验收步骤](docs/SOFTWARE_MANAGEMENT.md)。

本地检查：`pnpm check`、`pnpm db:check`、`pnpm test:plugin`（PHP 8.1+）、`pnpm build`、`pnpm compose:check`。集成测试先运行 `pnpm test:db:up`，设置 `TEST_DATABASE_URL=postgresql://sitepulse_test:sitepulse_test@127.0.0.1:5433/sitepulse_test` 后运行 `pnpm test:integration`，最后 `pnpm test:db:down`；不可使用生产数据库。

### 库存同步与状态

Connector **0.4.0** 在升级后的首次 WordPress 请求、重新启用，以及首次开启远程管理时，立即排入只读库存同步事件，不再等下一次 15 分钟心跳。实际采集仍依赖 WordPress Cron 执行；建议每分钟运行到期事件。“立即排队”不代表绕过 Cron 或即时完成。

在 **Plugins & themes** 每个站点卡片点击 **Sync inventory（同步库存）** 可主动请求重新采集；**Reload results** 只重新读取 SitePulse 已保存结果。手动同步无需开启远程修改权限，但需要已验证的工作区 owner/admin；请求在 Connector 下次每分钟轮询时领取，15 分钟无结果显示超时。重复待处理请求合并，完成后每站一分钟内不可再次请求。

界面独立显示尚未同步、排队等待、库存已收到、采集失败、等待超时，以及上次成功和尝试时间。失败保留旧库存，不影响独立的心跳状态；**Management ready** 不等于库存已收到。网络完全中断时，失败报告也可能无法送达：SitePulse 显示等待/超时，WordPress → Settings → SitePulse 可查看本地失败状态。修复 Cron/网络或 Connector 元数据后再次同步；Connector 0.4.0 的明确同步请求会使六小时本地安全扫描缓存失效，从而在下一次采集中重新扫描。

Deployment SSH verification: run `node scripts/test-deploy-ssh.mjs`. It uses local transport doubles; Linux also verifies deployment directory permissions. Windows requires Git Bash at `C:/Program Files/Git/bin/bash.exe`.

## WordPress security and inventory

The site directory and overview cards show independent HTTP availability, security and Connector health. HTTP labels distinguish UP, confirmed DOWN, first failure, confirming recovery, awaiting probes and overdue probes (scheduled time plus five minutes); Connector heartbeats never imply website availability. Security summaries show environment/advisory risk counts, highest severity, local code indicators, assessment time and incomplete/stale coverage. No reported risks is not a safety guarantee. Refresh data to reload the latest persisted results; this does not trigger a new probe or scan.

The Security view shows clickable severity counts and finding cards ordered from Critical to Unknown, with colored text badges and recommended actions. Selecting a severity filters environment risks and public advisories while leaving unscored local indicators visible; selecting it again or using Clear filter restores all findings. Exact duplicate advisory records are removed, while distinct advisory IDs with the same provider title and fixed boundary are grouped into one card with expandable IDs and sources. PHP issues direct administrators to hosting controls; plugin/theme advisories link to software management for verified managers. Fixed boundaries apply to individual advisories, not all component risks. Recommendations do not execute changes or guarantee remediation; stale/partial coverage and unscored local indicators remain explicit.

Connector 0.2.0 adds a tenant-scoped **Security** view and full installed plugin/theme inventory. Connector 0.4.0 extends the bounded local scan to selected JavaScript indicators and refreshes it on explicit inventory sync. Connected-site scanning remains read-only: no source contents, absolute paths, credentials or plugin settings are uploaded. The attachment library separately scans ZIP bytes that an administrator explicitly uploads for storage and approved installation; neither mechanism provides quarantine, full vulnerability discovery or arbitrary command execution.

The local scan is deliberately bounded and cached for six hours; a match requires human review, and no match is not proof of safety. Public advisory coverage can be partial for custom/premium components, unusual version strings, provider failures or inventories reaching the collection limit. The worker uses fixed WPVulnerability HTTPS endpoints and sends component identifiers/versions from the VPS IP, never the site URL. Set validated `SECURITY_ADVISORIES_ENABLED=false` locally or as a GitHub Environment variable to pause those lookups. See [security and inventory behavior, privacy, limitations and staging acceptance](docs/SECURITY_INVENTORY.md).

Apply migration `0011_many_smiling_tiger` through the normal backup-first deployment, then upgrade the WordPress plugin from `plugins/sitepulse-connector`. Slack/Telegram real-provider acceptance remains on the deployment TODO and is independent of this milestone.

通知现支持 Email、Bark、Slack 和 Telegram，每个通道可添加多个接收者，四种通道合计最多 20 个有效配置，共享验证/测试限额。所有通道接收相同的已确认故障、恢复和 Connector 失联事件；新增通道不会改变监控确认间隔。

启用 Slack / Telegram：在 GitHub 部署 Environment 中添加 Secret `NOTIFICATION_ENCRYPTION_KEY`，本地开发则写入未提交的 `.env`。用以下命令生成独立密钥：

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

此值须稳定保存和独立备份，API 与 worker 使用相同值。不要每次部署重新生成，也不要替换已有 `BARK_ENCRYPTION_KEY`。丢失该值后，已有 Slack / Telegram 配置需要删除并重新添加。不配置时，已有 Email / Bark 仍可使用。部署会按现有流程备份数据库并应用新增迁移 `0010_flawless_morg`。

- **Slack**：创建 Slack App，启用 Incoming Webhooks，为目标频道添加 Webhook，在 Notifications 页选择 Slack，填写名称和完整的 `https://hooks.slack.com/services/...` URL。每个 Webhook 单独添加；当前不支持 Gov Slack、自建代理或其他主机。
- **Telegram**：通过 BotFather 创建机器人并获取 Bot Token。私聊先发送 `/start`；群组先加入机器人并允许其发言。在 Notifications 页填写名称、Bot Token 和数字 Chat ID（群组通常为负数）。可在可信本机调用 Telegram Bot API 的 `getUpdates`，从 `message.chat.id` 获取；已设置 Webhook 的机器人请从已有可信更新处理程序读取 Chat ID，不要为此删除 Webhook。频道须授予机器人发帖权限，并从相应更新中读取 ID。不要将 Token 交给第三方查询工具，也不要写入 Git、日志或截图。

每个目的地添加后，会收到验证消息。点击 **Open SitePulse** 并明确确认后才接收常规告警；等待一分钟冷却后可发送测试。可以分别添加多个 Slack 频道和 Telegram 私聊/群组。凭据加密保存，读取时隐藏。群组确认仅证明能读取该消息，不授予工作区权限。验收包括两个接收者各一次故障/恢复、停用待发抑制和跨工作区隔离，详见 [通知说明](docs/NOTIFICATIONS.md)。网络超时后的重试可能重复，真实通道送达仍需部署后验证。

## 通知设置与收件人管理

侧栏 **Notifications** → 选择工作区，可管理故障和恢复的 Email、Bark、Slack 和 Telegram 通知。已验证的工作区 owner/admin 可添加多个收件人、重发验证、启停、删除、发送测试通知，以及关闭/开启成员自动接收邮件；其他成员只读。平台管理员身份不绕过工作区权限。

- 默认保留已验证成员自动接收。独立邮箱必须点击验证邮件中的链接，并在页面确认后才可接收；不需要注册 SitePulse，也不获得工作区访问权。
- 每个工作区最多 20 个有效收件人（四种通道合计），邮箱不区分大小写，同一事件同一收件人只入队一次；推送/聊天通道在超时重试时仍可能重复送达。托管邮箱覆盖同地址的成员自动接收，待验证、停用或删除后不会回退到成员投递；需要恢复时重新添加并验证。
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

All public, authentication and workspace pages follow [DESIGN.md](DESIGN.md). Shared design tokens live in `apps/web/app/globals.css`; follow [UI implementation guidelines](docs/UI_GUIDELINES.md) for future UI changes. The product uses readable system sans-serif typography, SVG navigation/status icons, blue primary actions and rounded white cards on a light background. The overview includes a connector distribution donut with textual counts, actionable attention items and site cards with direct Monitoring / Security / Inventory / Connection links. Charts use authorized site data, not illustrative trends; connector activity does not imply HTTP availability. Public marketing retains the original cream/monospace reference. No commercial font is bundled or downloaded.

Interactive controls use stronger outlines, bold button labels and 44px minimum heights. Active navigation uses bold blue text/icons on a light blue background, without notification-like dots; inline links remain underlined and card actions have outlined touch targets. Operational badges distinguish healthy, warning and critical states with readable semantic colors, icons and text. Errors and feedback appear in bordered tinted panels; quota and verification warnings are highlighted separately. Connector failures are announced as errors, and destructive actions retain confirmation dialogs.

SitePulse is a multi-tenant workspace for WordPress maintenance providers. Accounts, password recovery, email verification, organizations, isolated sites, WordPress connector pairing, revocable credentials, heartbeat freshness, minimized inventory, external HTTP/SSL checks, incidents, and deduplicated Email/Bark/Slack/Telegram incident and recovery alerts are implemented. Billing remains a separate milestone.

## Workspace navigation

The signed-in workspace uses a persistent sidebar: **Overview**, **Sites**, **Incidents**, and **Workspaces**. `/app/sites` lists sites across your authorized organizations, with name/hostname search, workspace filtering, connector status, recent unresolved incidents, and direct Monitoring / Security / Inventory / Connection links. `/app/sites/new` lets verified owners/admins select a workspace and opens pairing after creation. `/app/incidents` provides status/workspace filters and acknowledgement for verified owners/admins.

Site sections are directly addressable at `/app/sites/<id>?view=monitoring`, `?view=security`, `?view=inventory`, and `?view=connection`. Navigation adapts to small screens, and Refresh data reloads current server data. All reads and mutations retain API membership checks; UI filters do not grant access. Overview connector statistics describe heartbeat activity, not HTTP uptime. Lists include up to 1,000 sites and the latest 100 incidents per organization; unresolved counts apply to that recent history. The interface does not auto-poll.

## HTTP / SSL monitoring

The single-site Monitoring view uses side-by-side HTTP/SSL status cards and separate Recent checks / Incidents views, each paginated to five loaded records. Incident status filtering uses visible All statuses / Active / Resolved buttons instead of a native dropdown, with wrapping on narrow screens and a return to the first page on filter changes. Expandable lifecycle guidance keeps the page compact. Times are shown in UTC with full timestamps available on hover. This is not a full historical uptime percentage. Site navigation uses shared icon-based segmented links; Plugins & themes opens the current site's installed inventory directly, with an explicit Manage across sites link for bulk management.

Paired sites are monitored by the worker independently of connector heartbeats. Site details show HTTP availability, latency, certificate expiry, recent checks and incidents; organization pages list recent incidents. Verified owners/admins can acknowledge an incident. Two consecutive failures open an incident; two successes recover it. Disconnecting, rotating or re-pairing closes existing incidents with `connection_reset`, which does not assert recovery.

Only public HTTP(S) destinations on standard ports are allowed. Every connection and redirect resolves and validates all addresses, pins an approved address and verifies TLS. Each probe has a 10-second total budget, at most three redirects, and a 16 KiB header limit; response bodies are discarded. HTTPS downgrade is rejected. HTTP 200–399 is healthy after redirect processing; 4xx/5xx (including WAF blocks) count as failures. SSL checks validate the original HTTPS hostname and flag expiry at 14/7/3 days. HTTP-only sites have no SSL job.

Optional validated settings in `.env` or GitHub Environment Variables: `MONITORING_ENABLED=true`, `MONITOR_INTERVAL_SECONDS=300` (60–3600 seconds, 1–60 minutes), `SSL_INTERVAL_SECONDS=86400` (3600–604800). This is an operator-controlled global HTTP interval, not a tenant-supplied plan or permission. Existing GitHub Environment overrides remain effective: set `MONITOR_INTERVAL_SECONDS` to `300` or remove the old `900` override, then redeploy. Shorter intervals also tighten existing unleased healthy HTTP jobs in bounded batches. Set `MONITORING_ENABLED=false` and restart/redeploy to pause external probes; stored status/history remains visible. The worker needs outbound DNS and public HTTP/HTTPS access. PostgreSQL remains private and no worker port is published.

The first failed HTTP/SSL check displays **First failure — awaiting confirmation** without sending mail. A second failure, scheduled 60 seconds later, confirms the incident; repeated failures do not send duplicate opening alerts. Recovery requires two consecutive successful checks, also with a 60-second confirmation delay. At the default 5-minute interval, detection is nominally up to 5 minutes plus 1 minute for confirmation, **plus worker polling, probe runtime, queue lag and mail-provider delays**; this is not instant monitoring or a delivery SLA. For 1-minute checks, consider `WORKER_POLL_SECONDS=10`; the loop waits after each sweep and is not a fixed-rate timer.

Connector freshness is separate: WordPress still sends heartbeats every 15 minutes. After `HEARTBEAT_STALE_SECONDS` (default `2700`, 45 minutes; allowed 1800–86400), the worker opens one warning `stale_data` incident per loss episode and notifies eligible workspace recipients. A valid, non-replayed heartbeat resolves it and queues one recovery event. This does **not** assert website downtime or HTTP recovery. Already-degraded paired sites are included after upgrade. Disconnect/rotation/re-pairing closes incidents without claiming recovery. Heartbeat expiration and queued-mail delivery continue when external probes are disabled.

Migration `0008_flippant_shiver_man` permits Connector incidents. The normal deployment must back up before applying it; no production changes were performed during implementation. Follow [responsiveness acceptance](docs/MONITORING_RESPONSIVENESS.md) after deployment.

Migrations through `0010_flawless_morg` add monitoring jobs, checks, incidents, the durable notification outbox with stale-worker fencing, workspace notification settings, verified recipients and four-channel metadata. Deployment backs up before applying registered migrations. Checks are retained for 30 days and resolved incidents for 90 days, with bounded cleanup. A worker claims at most four probe jobs plus five deliveries per channel (20 across Email/Bark/Slack/Telegram) per poll (default 60 seconds); retry timestamps are due times, not delivery guarantees. Alerts use the workspace's verified, enabled recipient policy. Validate capacity before scaling beyond a small pilot. See [monitoring acceptance](docs/MONITORING_ACCEPTANCE.md) and [notification delivery](docs/NOTIFICATIONS.md).

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
