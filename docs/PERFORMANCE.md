# Google PageSpeed performance

SitePulse calls Google PageSpeed Insights directly using one platform API key. Customers do not need Site Kit, Google OAuth or a Google account. This milestone tests the registered entry page on mobile and desktop; it does not collect GA4, Search Console, CrUX field data or real-user Core Web Vitals.

## Administrator setup

1. 按下面的「获取 PAGESPEED_API_KEY」创建平台密钥，启用同一项目的 PageSpeed Insights API，并限制密钥用途。无需客户逐站申请。
2. Set `PAGESPEED_API_KEY` privately and `PERFORMANCE_ENABLED=true` for API and worker. `PERFORMANCE_MAX_DAILY_REQUESTS` defaults to 500 and allows 2–25000. It is a shared rolling 24-hour attempt budget, not a guarantee of Google quota. Each mobile or desktop request consumes one reservation, including failed or interrupted attempts. `PERFORMANCE_INTERVAL_SECONDS` controls automatic checks per device: default 86400 (24 hours), minimum 3600 (1 hour), maximum 2592000 (30 days).
3. For GitHub deployments, use an Environment Secret named `PAGESPEED_API_KEY` and Environment Variables `PERFORMANCE_ENABLED`, optionally `PERFORMANCE_MAX_DAILY_REQUESTS` and `PERFORMANCE_INTERVAL_SECONDS`. Configuration generation and Compose pass these settings to backend services only. Never place the key in browser variables, source control or support messages.
4. Through the separately authorized deployment workflow, back up the database and apply migration `0019_charming_cassandra_nova.sql`. Deploy API, worker and web together. No Connector upgrade is needed. This implementation does not deploy or migrate production automatically.

### 获取 PAGESPEED_API_KEY

这是平台管理员在 Google Cloud 创建的 API 密钥，`PAGESPEED_API_KEY` 是 SitePulse 保存这串密钥的配置名称。下面的 Google 菜单同时列出中英文名称；控制台界面可能随语言或更新略有变化。

1. 用平台管理员的 Google 账号登录 [Google Cloud Console](https://console.cloud.google.com/)。点击顶部项目选择器，选择已有项目，或点击 **新建项目 / New project**，例如命名为 `SitePulse`。后续启用 API 和创建密钥都在这个项目中操作。
2. 打开左侧 **API 和服务 / APIs & Services → 库 / Library**，搜索 **PageSpeed Insights API**，进入详情并点击 **启用 / Enable**。如果已显示 **管理 / Manage**，说明已经启用。也可打开 [PageSpeed API 的 API 库页面](https://console.cloud.google.com/apis/library/pagespeedonline.googleapis.com)，先确认顶部项目正确。
3. 进入 **API 和服务 → 凭据 / Credentials → 创建凭据 / Create credentials → API 密钥 / API key**。可将名称设为 `SitePulse PageSpeed Worker`。本功能使用普通 API Key；如果出现 **Authenticate API calls through a service account** 选项，保持不勾选。无需为本功能创建 OAuth 同意屏幕、OAuth Client ID 或服务账号 JSON 文件。
4. 在创建界面或创建后的密钥编辑页，找到 **API 限制 / API restrictions**，选择 **限制密钥 / Restrict key**，只勾选 **PageSpeed Insights API**，保存。若列表中找不到它，回到第 2 步检查是否在同一个项目中启用 API；新界面可能要求先设置 API 限制才能完成创建。
5. 在 **应用限制 / Application restrictions** 中，生产部署有固定出口时选择 **IP 地址 / IP addresses**，添加运行 SitePulse Worker 的服务器对外出口公网 IP。填写 Google 实际看到的出口 IP；经过 NAT/代理时可能与服务器网卡地址不同，多台 Worker 需覆盖各自出口。不要填 Docker 内网 IP、被监测的 WordPress 服务器 IP，或把限制类型选成 **网站 / Websites（HTTP referrers）**，因为调用由 Worker 发起。暂时没有固定出口时可以保留 **无 / None** 来联调，同时保留第 4 步的 API 限制；确认出口后再收紧。
6. 点击 **创建 / Create** 或 **保存 / Save**，复制密钥弹窗中的完整字符串。这个字符串就是 `PAGESPEED_API_KEY` 的值，不是项目 ID、密钥的显示名称或 OAuth Client Secret。保存在密码管理器或部署 Secret 中，不要贴到聊天、截图或代码里。
7. 在 **API 和服务 → 已启用的 API 和服务 / Enabled APIs & services → PageSpeed Insights API → 配额和系统限制 / Quotas & System Limits** 查看该项目实际获批的配额；菜单也可能简称 **Quotas**。SitePulse 的默认 `500` 是自身滚动 24 小时请求上限，不会给 Google 项目增加配额。移动端和桌面端各消耗一次请求。

官方参考：[PageSpeed Insights API 入门与密钥说明](https://developers.google.com/speed/docs/insights/v5/get-started)、[Google Cloud 创建与限制 API 密钥](https://docs.cloud.google.com/docs/authentication/api-keys)。

### 填入 SitePulse（GitHub Actions 部署）

在 GitHub 仓库进入 **Settings → Environments → 实际部署环境（staging 或 production）**。与现有 VPS 部署配置使用同一个 Environment：

| 位置                                             | 名称                             | 值                                                               |
| ------------------------------------------------ | -------------------------------- | ---------------------------------------------------------------- |
| Environment secrets → Add environment secret     | `PAGESPEED_API_KEY`              | 上一步复制的完整 Google API 密钥                                 |
| Environment variables → Add environment variable | `PERFORMANCE_ENABLED`            | `true`                                                           |
| Environment variables → Add environment variable | `PERFORMANCE_MAX_DAILY_REQUESTS` | `500`，可选；按 Google 项目配额和站点数量调整                    |
| Environment variables → Add environment variable | `PERFORMANCE_INTERVAL_SECONDS`   | `86400` 默认 24 小时；范围 3600–2592000 秒（1 小时–30 天），可选 |

保存 GitHub 配置后，需要通过正常、单独授权的部署流程重新部署，现有容器才会加载新值；无需给每个 WordPress 站点填写。已有部署流程会在迁移前备份，并应用包括 `0019` 在内的待执行迁移。修改该间隔后，Worker 会按新间隔重算现有站点的下一次自动检查；正在运行或手动排队中的任务不受重算影响。首次启用后，在已连接站点的 **Performance** 标签查看移动端和桌面端状态；队列仍受 Worker 调度和平台配额限制，不会保存配置后立即出分。

如果使用本地或手工 Compose 部署，则把同名配置写入未纳入版本控制的部署 `.env`，随后通过相应部署流程重建/重新创建 API 和 Worker，使新环境变量生效。不要设置 `NEXT_PUBLIC_PAGESPEED_API_KEY`，也不要把真实密钥写进 `.env.example`。

无法出分时，先检查 Google 项目、API 启用状态、密钥的 API/IP 限制和配额。SitePulse 中 `PROVIDER_REJECTED` 可能是密钥、API 或限制问题；`QUOTA_EXCEEDED` 表示 Google 拒绝了超配额请求。排查时只提供脱敏错误分类，不提供密钥。

## Scheduling and presentation

Only non-deleted active/degraded sites with an unrevoked Connector credential are eligible. The worker seeds two durable jobs per site, leases at most two per sweep, gives leases 180 seconds and bounds each Google request to 90 seconds and 4 MiB. Checks are scheduled `PERFORMANCE_INTERVAL_SECONDS` after completion (default 24 hours; 1 hour–30 days). Shared quota exhaustion delays pending work. Replicas serialize reservations in PostgreSQL; crashes consume their existing reservation and an expired lease can be reclaimed with a new one.

Verified workspace owners/admins may queue both devices together, with a 15-minute cooldown after the latest request/attempt and no duplicate queue while pending/running. Members can read. All endpoints check server-side membership and all mutations require a trusted Origin. Connection reset removes jobs and fences outstanding results; attempt history remains until retention/deletion.

The directory and site Performance tab show 0–100 Lighthouse lab scores. Detail cards include FCP, LCP, Speed Index, TBT, CLS and up to five timing opportunities. Missing metrics remain unavailable; zero is a valid score. Scores vary between runs. A failed latest attempt retains the previous successful score and its timestamp. Results older than 26 hours are stale unless queued/running/error has a more immediate status. History shows the latest 30 attempts within 30 days, five per page. Unfinished attempts older than 180 seconds are marked interrupted; worker cleanup deletes up to 500 old attempts per sweep. Latest successful reports persist on jobs until connection reset or site deletion.

## Privacy and network boundary

Google receives the registered public page URL and fetches the page using its own infrastructure. SitePulse resolves the submitted hostname and rejects private/mixed DNS, credentials, nonstandard ports, query strings and fragments before calling the fixed HTTPS Google endpoint. The worker never connects to the audited page for this feature and does not follow provider redirects. Google's own page-fetch redirects and DNS behavior are outside SitePulse's network enforcement boundary. Do not register confidential page paths. Only bounded selected metrics, titles and metadata are persisted; provider bodies, API keys and raw request errors are never logged or returned.

Set `PERFORMANCE_ENABLED=false` and redeploy API/worker to stop new requests. Saved results remain visible and an in-flight request may finish. A 403 usually requires checking API enablement/key restrictions; 429 requires checking project quota and reducing the local budget. Failures are deliberately sanitized. Validate real API access with a controlled public site after configuration: confirm both reports, timestamps, daily schedule and failure visibility. Automated tests use fixtures and a disposable database, not the real Google key. Disabling the feature is the rollback path; do not delete applied migrations or production history.
