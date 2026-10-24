# Milestones

1. Foundation: implemented repository, toolchain, SQL migrations, container configuration, authentication, organizations, isolation tests, and docs. Disposable local Docker image builds, migration-first startup, service health and web/API proxy smoke checks pass; see STAGING_ACCEPTANCE_REPORT.md. Live HTTPS acceptance remains separate.
2. Authentication recovery: implemented Better Auth password reset, email verification, private development outbox and production Resend transport. Automated expiration, replay, session revocation and generic-response tests pass; real provider delivery still needs staging verification.
3. Connector pairing and heartbeat: implemented tenant-scoped sites, public URL/DNS registration validation, single-use challenges, hash-only credentials, rotation/revocation, installable single-site WP plugin, heartbeat and independent stale sweeps. API concurrency/isolation tests and PHP contract tests exist. Live WordPress acceptance is pending; see CONNECTOR_ACCEPTANCE.md. Inventory remains a separate next task.
4. External monitoring: SSRF-safe HTTP and SSL checks, PostgreSQL jobs, transactional incident states, deduplication, controlled retries. Verify simulated outage/recovery before notifications.
5. Notifications: verified destinations, delivery queues, idempotent event keys, bounded retries, recovery events.
6. Billing and launch: seller-eligible provider, signed/idempotent webhooks, centralized entitlements, data lifecycle, production hardening, backup restore drill, and external pilots.

Authentication mail must have a verified sender and successful live delivery before public pilots. Each milestone requires its own tests and documentation; contract tests must not be presented as live WordPress acceptance.
