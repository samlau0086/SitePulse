# 邮件告警验收记录 — 2026-10-25

状态：本地准备完成，真实 staging 验收未执行。此记录不构成生产发布或迁移授权。

候选应用基线：`1445ded8538adaf3d56a6dff3bc5b2ac7c0faf88`。本次额外修改仅涉及验收文档、README 和 CHANGELOG。执行步骤见 [邮件告警验收手册](NOTIFICATION_ACCEPTANCE.md)。

| 检查                    | 结果                                                                                                                        |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `pnpm check`            | 通过：格式、lint、类型检查与 96 个单元测试                                                                                  |
| `pnpm test:integration` | 通过：63 个测试，专用 disposable PostgreSQL 17 `_test` 数据库                                                               |
| `pnpm build`            | 通过：API、worker、web                                                                                                      |
| `pnpm compose:check`    | 通过：production、development、test 配置隔离断言                                                                            |
| 手册只读 SQL            | 在完成迁移的 disposable 库执行成功；使用不存在的测试 site UUID，结果为空，重复及不合格收件人计数为零，仅证明查询兼容 schema |

集成测试在 Windows 沙箱内因 Vite 子进程 `spawn EPERM` 启动失败，批准在沙箱外运行后通过。测试仍有现存 Fastify `disableRequestLogging` 弃用提示。SQL 验证首次被沙箱拒绝 Docker 管道访问，批准后通过。以上均不是对真实 Resend 的发信测试。

公开 GitHub Actions 最近的 `SitePulse checks` run `40157132199` 显示成功，修订为上述候选基线；该公开信息不证明部署 job 已执行，也不证明服务器当前版本。当前 GitHub CLI 登录凭据失效，staging secrets/variables 名称读取返回 HTTP 401，未发起 workflow、修改 GitHub 设置或连接 VPS。

尚需恢复 GitHub 登录，并明确独立 staging 地址、自己控制的故障测试站点、已验证测试收件人和隔离对照账号。不要将密钥或密码写入本报告或聊天。未向 provider 发邮件，未操作受控站点，未执行线上数据库查询、备份或迁移。

真实 incident/recovery 邮件、持续失败去重、跨租户投递、provider 拒绝/重试及最终收件箱送达均保持“未执行”。本地集成测试覆盖模拟 provider 拒绝后的重试及成员排除，不能替代线上证据。取得访问条件后，按手册逐项补充 UTC 时间、修订和脱敏证据。
