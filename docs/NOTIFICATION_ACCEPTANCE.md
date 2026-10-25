# 邮件告警 staging 验收

本流程仅针对独立 staging、自己控制的故障测试站点和指定测试邮箱。通过 CI、容器健康检查或 Resend 接受请求，均不能单独证明收件箱已收到邮件。通知实现和限制见 [NOTIFICATIONS.md](NOTIFICATIONS.md)。

## 1. 部署前准备

在 GitHub `staging` Environment 核对以下配置；不要在日志、聊天或验收报告中粘贴值：

| 类型     | 名称                       | 用途                                                     |
| -------- | -------------------------- | -------------------------------------------------------- |
| Variable | `APP_ORIGIN`               | 独立 staging 的 HTTPS origin，邮件中的历史链接使用此地址 |
| Variable | `AUTH_MAIL_FROM`           | Resend 已验证域名下的发件邮箱                            |
| Secret   | `RESEND_API_KEY`           | 具有发信权限的密钥，API 和 worker 共用配置               |
| Variable | `MONITORING_ENABLED`       | `true`                                                   |
| Variable | `MONITOR_INTERVAL_SECONDS` | 验收期间可设 `300`，验收后恢复原值                       |
| Variable | `SSL_INTERVAL_SECONDS`     | 保留原值；HTTP 故障场景不需要缩短 SSL 间隔               |

其余 VPS、数据库、认证和备份配置沿用 [GitHub Actions 部署说明](GITHUB_ACTIONS_VPS.md)。无需新增通知专用密钥。工作流强制 production 运行模式和 Resend transport，因此 staging 不能使用 file transport。确认 staging 与生产使用不同 Compose project、数据库、端口和测试账号。不要将现有生产域名直接作为故障测试站点。

候选修订必须包含迁移 `0004` 和 `0005`。通过现有 `SitePulse checks` workflow，选择 `main` 和 `environment=staging`；部署流程会先创建加密备份，备份成功才执行迁移。记录成功的 run、候选 SHA、备份文件是否存在以及 HTTPS 验证结果。备份文件存在不代表已验证恢复能力。此流程不授权 production 部署。

## 2. 准备受控事件

使用组织 A 的已验证测试账号，添加并配对自己控制的独立 HTTPS 站点。准备组织 B 的已验证测试账号作为隔离对照。保留证书有效、heartbeat 正常，只切换受控站点的 HTTP 响应状态；不要改 SitePulse 自身的健康接口。

当前没有团队邀请或通知收件人管理 UI。不要为验收直接修改 staging 成员表或认证表。若无法通过现有支持的账号流程建立同组织的未验证成员，该子项记录为“线上未执行”；同组织未验证收件人排除由 disposable 集成测试覆盖，不能声称线上已验证。

1. 等待站点首次正常 HTTP 检查，记录测试 site UUID 和开始时间（UTC）。
2. 仅将受控目标改为返回 `503`。第一次失败应为疑似异常；再次失败确认一个 incident。重试通常在 60 秒后到期，还需等待 worker 轮询和队列，不能以精确 60 秒作为失败判据。
3. 确认组织 A 的已验证邮箱收到一封 `Incident:` 邮件，站点和 monitor 类型正确，历史链接指向 staging。组织 B 不得收到邮件。
4. 让目标持续失败至少两个后续检查。对同一个 incident，每个收件人仅有一条 `opened` delivery，不能重复发送。
5. 恢复目标为 `200`。两次成功后，同一个 incident 应以 recovered 原因关闭，收到一封 `Recovered:` 邮件。确认 acknowledgement 不会被当作恢复，额外成功检查不产生重复恢复邮件。
6. 私下核对 Resend 事件和实际测试收件箱（包括垃圾箱）；分别记录 provider 接受、最终送达或退信，以及收件箱收到状态。不要把邮箱地址、provider ID 或邮件正文提交到仓库。

## 3. 只读核对数据库

优先通过已有受信任管理通道读取；以下命令可在 VPS 上操作专用 staging。它们不会公开 PostgreSQL 端口，也不打印 `.env`。不要使用 `docker compose config` 或 `docker inspect` 导出配置。

```sh
cd /opt/sitepulse-staging
export SITEPULSE_RELEASE="$(cat current-release.txt)"
export WEB_BIND_PORT="$(cat current-web-bind-port.txt)"
docker compose -p sitepulse-staging --env-file shared/.env -f current/docker-compose.yml exec sitepulse-db sh -c 'exec psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
```

在 psql 中设置本次测试的 site UUID 和开始时间。所有查询限定该站点和时间；输出只含状态和计数，不含收件邮箱、站点名称、provider ID 或邮件内容。若 incident 被保留策略清理导致关联为空，不把这些行当作本次验收证据。

```sql
\set test_site_id 'REPLACE_WITH_TEST_SITE_UUID'
\set acceptance_start '2026-10-25T00:00:00Z'
BEGIN READ ONLY;

SELECT d.event_type, d.status, d.attempts, d.last_error_code,
       count(*) AS deliveries,
       min(d.next_attempt_at) AS earliest_due,
       max(d.sent_at) AS last_handoff
FROM notification_deliveries d
JOIN incidents i ON i.id = d.incident_id
WHERE i.site_id = :'test_site_id'::uuid
  AND d.created_at >= :'acceptance_start'::timestamptz
GROUP BY d.event_type, d.status, d.attempts, d.last_error_code
ORDER BY d.event_type, d.status, d.attempts;

-- 每个 incident / event / recipient 应恰好一行；预期为零组重复。
SELECT count(*) AS duplicate_groups
FROM (
  SELECT d.incident_id, d.event_type, d.recipient
  FROM notification_deliveries d
  JOIN incidents i ON i.id = d.incident_id
  WHERE i.site_id = :'test_site_id'::uuid
    AND d.created_at >= :'acceptance_start'::timestamptz
  GROUP BY d.incident_id, d.event_type, d.recipient
  HAVING count(*) > 1
) duplicates;

-- 在整个验收期间冻结测试成员关系/邮箱验证状态，预期为 0。
SELECT count(*) AS ineligible_recipients
FROM notification_deliveries d
JOIN incidents i ON i.id = d.incident_id
JOIN sites s ON s.id = i.site_id
WHERE s.id = :'test_site_id'::uuid
  AND d.created_at >= :'acceptance_start'::timestamptz
  AND NOT EXISTS (
    SELECT 1 FROM organization_members m
    JOIN users u ON u.id = m.user_id
    WHERE m.organization_id = s.organization_id
      AND u.email = d.recipient AND u.email_verified = true
  );

ROLLBACK;
\q
```

`sent` 表示 provider 接受，不代表投递成功。收件人是在事件入队时生成的快照；之后成员或邮箱验证状态变化不适合用上述当前状态查询作判断。`sending` 的租约为 60 秒，超期可重新认领；网络调用不持有数据库事务锁。

## 4. 失败与重试

不要替换共享 staging 的 Resend 密钥、暂停客户 worker、修改 delivery 表或人为阻断正常用户的邮件。真实 provider 拒绝测试仅在没有其他收件人和待发邮件的独立 disposable 环境执行；没有该环境则将真实拒绝标记为待验收。

本地确定性回归：`pnpm test:db:up`，设置专用 `TEST_DATABASE_URL` 后运行 `pnpm test:integration`，最后 `pnpm test:db:down`。其中 monitoring 集成测试模拟 Resend 拒绝并验证退避与成功重试、恢复及收件人隔离，不向真实 provider 发信。测试命令及数据库说明见 README。

真实拒绝场景需记录 sanitized `PROVIDER_REJECTED`、`PROVIDER_INVALID_RESPONSE` 或 `PROVIDER_UNAVAILABLE`、attempts 增长及未来 `next_attempt_at`。默认退避由 30 秒增长至一小时，最多 8 次；不通过篡改时间或数据库来强行加速线上重试。恢复 provider 配置后等待 worker 再试，核对唯一 event 和最终状态。失败终态没有自动重放 UI，不要直接改为 queued 作为恢复办法。

## 5. 记录与完成条件

复制下表到独立、脱敏的验收记录中。保留先前历史报告，不覆盖旧里程碑的证据。没有执行的项目明确写“未执行”及原因。

| 项目                                     | 状态   | 脱敏证据                   |
| ---------------------------------------- | ------ | -------------------------- |
| 候选 SHA / workflow run / UTC 时间       | 待执行 |                            |
| 专用 staging / 受控站点 / 测试邮箱已确定 | 待执行 | 仅记录标签，不记录个人数据 |
| 加密备份成功，迁移 0004 / 0005 完成      | 待执行 |                            |
| HTTPS / worker 正常，数据库无公开端口    | 待执行 |                            |
| Incident provider 接受与收件箱收到       | 待执行 | 分开记录                   |
| 持续异常不重复发送                       | 待执行 |                            |
| Recovery provider 接受与收件箱收到       | 待执行 | 分开记录                   |
| 跨组织与未验证成员排除                   | 待执行 | 区分线上与 disposable 测试 |
| Provider 拒绝、退避与重试                | 待执行 | 区分线上与模拟测试         |
| 恢复原监控间隔、受控站点恢复 200         | 待执行 |                            |

完成后再提出生产发布申请，包含候选修订、未执行子项、备份及恢复证据。此清单本身不构成生产迁移授权。
