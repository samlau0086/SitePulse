# Changelog

## Unreleased — 2026-10-24

- Added configurable GitHub Environment WEB_BIND_PORT for VPS deployments, validated port forwarding to Compose and health checks, and a successful-release port record for administration.
- Added explicit deployment-stage errors and actionable remote setup diagnostics for missing directories/configuration, with transport-failure and custom/invalid-port regression checks.
- Made VPS_KNOWN_HOSTS optional: discover SSH host keys per deployment when omitted, abort on discovery failure, retain configured key pinning and document the identity-verification limitation.
- Expanded README with Chinese GitHub Actions VPS setup, environment secrets, server prerequisites, HTTPS, deployment triggers, and recovery guidance.
- Added opt-in GitHub Actions staging deployment and manually confirmed production deployment to a Linux VPS after CI checks, with optional pinned SSH host keys and server-only application secrets.
- Added release-tagged images, encrypted pre-migration database dumps, serialized deployments, fail-closed recovery, internal/public HTTPS health checks, and deployment fault-injection checks; documented VPS, TLS, email, backup and rollback setup.

- Verified disposable local Docker image builds, migration-first startup and web/API proxy health on PostgreSQL 17.11; recorded missing live HTTPS WordPress and email prerequisites before inventory work.
- Added Better Auth password recovery, expiring single-use reset links, concurrent replay protection, and revocation of all sessions on reset.
- Added registration verification mail, resend and confirmation, verification timestamps, account recovery pages, and sanitized security audit events.
- Added development file outbox and production Resend transport with validated configuration and generic public responses.
- Added tenant-isolated sites and migration 0001, verified administrator writes, public URL/DNS registration validation, and site dashboard pages.
- Added expiring single-use pairing codes, hash-only site credentials, rotation, revocation, soft deletion and transactional security audits.
- Added a single-site WordPress connector with nonce/capability guards, bounded HTTPS requests, scheduled heartbeats, capped retry backoff and explicit disconnection.
- Added monotonic heartbeat replay protection, database receipt timestamps and an independent worker for stale connection detection and recovery.
- Added concurrent pairing/replay, credential lifecycle, stale recovery, tenant isolation, URL safety and PHP plugin contract tests. Live WordPress acceptance remains pending.

## 0.1.0 — 2026-10-23

- Initialized a pnpm TypeScript monorepo with a Next.js frontend and Fastify API.
- Added validated configuration, linting, formatting, unit and PostgreSQL integration tests, and GitHub Actions CI.
- Added PostgreSQL schema and version-controlled migrations for users, organizations, organization members, audit logs, and Better Auth support tables.
- Added registration, login, database-backed sessions, logout, CSRF checks, authentication rate limits, and sanitized audit events.
- Added organization creation, tenant-scoped listing/details, owner/admin updates, and privileged audit-log access.
- Added local and production Compose configurations, private production database networking, and migration-first startup.
- Documented development, test, migration, deployment, backup, rollback, and foundation limitations.
