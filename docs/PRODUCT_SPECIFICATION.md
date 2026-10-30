# SitePulse — Complete Product & Technical Specification

**Document Version:** 1.0  
**Post-MVP additions:** Sections 16–17 explicitly permit opt-in plugin/theme management and a scanned tenant package library; earlier MVP exclusions retain their original foundation scope.
**Status:** Ready for MVP implementation planning  
**Product Type:** Multi-tenant SaaS + WordPress connector plugin  
**Target Market:** WordPress freelancers, agencies, and website maintenance providers  
**Primary Goal:** Launch a reliable paid MVP with minimal operational complexity

---

# 1. Product Requirements Document (PRD)

## 1.1 Product Vision

SitePulse is a cloud-based monitoring platform that helps WordPress professionals monitor multiple client websites from a single dashboard.

Users should be able to identify website downtime, SSL certificate expiration, WordPress update requirements, and stale monitoring data without logging into every WordPress installation.

The product must prioritize reliability, simplicity, actionable alerts, and a short onboarding process.

## 1.2 Target Customers

Primary customers:

- Freelance WordPress developers managing 5–20 websites.
- Small web design agencies managing 10–100 websites.
- Website maintenance providers offering monthly maintenance plans.

Secondary customers:

- WooCommerce maintenance specialists.
- Managed WordPress hosting providers.
- Small digital agencies managing client infrastructure.

The MVP should optimize for individual professionals and small agencies rather than enterprise hosting companies.

## 1.3 Customer Problems

1. Website outages may remain unnoticed until clients report them.
2. SSL certificates can expire unexpectedly.
3. WordPress core, plugin, and theme updates are difficult to track across multiple sites.
4. Monitoring tools often generate alerts without sufficient context.
5. Agencies need a single overview of client website health.
6. Developers spend unnecessary time logging into individual sites for routine checks.

## 1.4 MVP Success Criteria

Initial validation targets, not guaranteed business outcomes:

- At least 5 external pilot users.
- At least 20 connected websites.
- At least 3 paying customers or paid pilot agreements.
- At least 90% of test downtime scenarios detected within the configured monitoring window.
- No unresolved critical cross-tenant authorization defects.
- At least 95% successful delivery attempts for valid email notifications, measured at the application-provider handoff level.
- Median onboarding time below 5 minutes for a technically competent WordPress user.

The product should not be considered commercially validated merely because the application works.

## 1.5 MVP Features

### P0 — Required for launch

1. User registration, login, and password recovery.
2. Organization/workspace creation.
3. WordPress site registration and pairing.
4. External HTTP availability checks.
5. SSL certificate expiration monitoring.
6. WordPress core, plugin, and theme update inventory.
7. Site health dashboard.
8. Email alerts with deduplication and recovery notifications.
9. Site heartbeat and stale-data detection.
10. Site disconnection and credential revocation.
11. Basic subscription limits and manual entitlement administration.
12. Audit logs for security-sensitive operations.

### P1 — After the first paid customers

- Customer grouping and client labels.
- Branded PDF maintenance reports.
- Telegram or Slack notifications.
- Longer monitoring history.
- Multiple team members.
- Additional notification policies.
- Integration with backup plugins to report existing backup status.

### Explicitly excluded from MVP

- Remote WordPress updates.
- Remote plugin installation or deletion.
- Remote shell execution.
- Full backup storage and restoration.
- Malware scanning.
- Automated vulnerability remediation.
- Advanced AI diagnostics.
- White-label custom domains.
- Complex role-based access control.

---

# 2. System Architecture

## 2.1 Architecture Overview

The application consists of five major components:

1. SaaS frontend.
2. SaaS API.
3. PostgreSQL database.
4. Background job workers.
5. WordPress connector plugin.

The SaaS performs public website and SSL checks. The WordPress plugin sends authenticated inventory and health information to the API.

The API stores normalized data and schedules notifications. Workers execute monitoring jobs independently of frontend requests.

## 2.2 Recommended Technology Stack

### SaaS frontend

- Next.js with TypeScript.
- React.
- Tailwind CSS.
- A maintained accessible component library.
- Server-side session handling.
- Responsive dashboard layouts.

Astro is also suitable if most pages are static and the dashboard is relatively simple. For a single-stack MVP with authentication and interactive dashboard pages, Next.js is the default recommendation.

### API

- Node.js.
- TypeScript.
- Fastify or NestJS.
- REST API under `/api/v1`.
- Schema validation using Zod or an equivalent validation library.
- OpenAPI documentation.

Use one API framework consistently. Avoid introducing multiple API frameworks into the MVP.

### Database

- PostgreSQL.
- Prisma or Drizzle ORM.
- Version-controlled SQL migrations.
- UTC timestamps.
- UUID primary keys.
- Foreign-key constraints.

### Background processing

For the initial deployment, use PostgreSQL-backed jobs if throughput is modest. Add Redis and BullMQ only when the workload or retry requirements justify them.

Background tasks include:

- Website availability checks.
- SSL checks.
- Heartbeat expiration processing.
- Alert generation.
- Email delivery.
- Retention cleanup.

### Infrastructure

- Docker Compose.
- 1Panel or another Docker-compatible host.
- Reverse proxy with HTTPS.
- Cloudflare DNS/WAF where appropriate.
- Automated database backups.
- External uptime checks for the SaaS itself.

Do not make the SaaS depend on the same website it monitors for its own alert delivery.

## 2.3 Logical Data Flow

WordPress plugin → authenticated API → PostgreSQL → dashboard.

Separately:

Monitoring scheduler → HTTP/SSL workers → PostgreSQL → alert processor → email provider.

The SaaS must continue running monitoring jobs even when the user closes the dashboard.

## 2.4 Deployment Services

Recommended initial containers:

- `sitepulse-web`: frontend and application routes.
- `sitepulse-worker`: background tasks.
- `sitepulse-db`: PostgreSQL.
- `sitepulse-redis`: optional, only if using BullMQ.
- Reverse proxy: HTTPS termination and routing.

Keep PostgreSQL and Redis private to the Docker network. Do not expose database ports publicly.

---

# 3. Repository Structure

Use a monorepo so Codex can implement the application and plugin with shared API documentation.

```text
sitepulse/
├── AGENTS.md
├── README.md
├── CHANGELOG.md
├── SECURITY.md
├── .env.example
├── docker-compose.yml
├── package.json
├── pnpm-workspace.yaml
├── apps/
│   ├── web/
│   │   ├── app/
│   │   ├── components/
│   │   ├── lib/
│   │   └── tests/
│   └── worker/
│       ├── src/
│       │   ├── jobs/
│       │   ├── monitors/
│       │   ├── alerts/
│       │   └── notifications/
│       └── tests/
├── packages/
│   ├── database/
│   │   ├── schema/
│   │   ├── migrations/
│   │   └── client/
│   ├── shared/
│   ├── api-contracts/
│   └── config/
├── plugins/
│   └── sitepulse-connector/
│       ├── sitepulse-connector.php
│       ├── includes/
│       ├── admin/
│       ├── assets/
│       ├── languages/
│       └── tests/
├── docs/
│   ├── PRD.md
│   ├── ARCHITECTURE.md
│   ├── DATABASE.md
│   ├── API.md
│   ├── SECURITY.md
│   ├── DEPLOYMENT.md
│   └── CODEX_TASKS.md
└── scripts/
    ├── dev.sh
    ├── test.sh
    └── deploy-check.sh
```

The exact framework-generated directory layout may differ, but API contracts, database migrations, security documentation, and automated tests must remain version-controlled.

---

# 4. Database Schema

All customer-owned records must be tenant-scoped. Every query involving organization-owned resources must verify organization membership and authorization.

Use UUIDs as primary keys and `timestamptz` for timestamps.

## 4.1 users

| Column | Type | Notes |
|---|---|---|
| id | UUID | Primary key |
| email | CITEXT or normalized TEXT | Unique |
| password_hash | TEXT | Argon2id or framework-managed hash |
| email_verified_at | TIMESTAMPTZ | Nullable |
| created_at | TIMESTAMPTZ | Required |
| updated_at | TIMESTAMPTZ | Required |

Use a maintained authentication implementation rather than building password security from scratch.

## 4.2 organizations

| Column | Type | Notes |
|---|---|---|
| id | UUID | Primary key |
| name | TEXT | Required |
| slug | TEXT | Unique |
| owner_user_id | UUID | References users |
| plan_code | TEXT | free, pro, agency |
| created_at | TIMESTAMPTZ | Required |
| updated_at | TIMESTAMPTZ | Required |

## 4.3 organization_members

| Column | Type | Notes |
|---|---|---|
| organization_id | UUID | Foreign key |
| user_id | UUID | Foreign key |
| role | TEXT | owner, admin, member |
| created_at | TIMESTAMPTZ | Required |

Primary key: `(organization_id, user_id)`.

For MVP, membership may be restricted to the organization owner, but the schema should support future team access.

## 4.4 sites

| Column | Type | Notes |
|---|---|---|
| id | UUID | Primary key |
| organization_id | UUID | Tenant reference |
| name | TEXT | Display name |
| canonical_url | TEXT | Normalized URL |
| hostname | TEXT | Normalized hostname |
| status | TEXT | pending, active, degraded, down, disconnected |
| last_seen_at | TIMESTAMPTZ | Nullable |
| last_success_at | TIMESTAMPTZ | Nullable |
| created_at | TIMESTAMPTZ | Required |
| updated_at | TIMESTAMPTZ | Required |
| deleted_at | TIMESTAMPTZ | Nullable soft deletion |

Normalize scheme, hostname, and default ports. Do not trust a submitted hostname without validation.

## 4.5 site_credentials

| Column | Type | Notes |
|---|---|---|
| id | UUID | Primary key |
| site_id | UUID | Unique site reference |
| credential_hash | TEXT | Hash of a high-entropy API secret |
| encrypted_secret | BYTEA or TEXT | Only if encrypted recovery is required |
| secret_version | INTEGER | Rotation version |
| last_used_at | TIMESTAMPTZ | Nullable |
| revoked_at | TIMESTAMPTZ | Nullable |
| created_at | TIMESTAMPTZ | Required |

Prefer storing only a hash of the site secret. If a secret must be recoverable, encrypt it with a dedicated key-management mechanism.

Never store WordPress administrator passwords.

## 4.6 site_inventory_snapshots

| Column | Type | Notes |
|---|---|---|
| id | UUID | Primary key |
| site_id | UUID | Tenant-owned site |
| wp_version | TEXT | Nullable |
| php_version | TEXT | Nullable |
| active_plugins | JSONB | Minimized inventory |
| inactive_plugins | JSONB | Optional |
| themes | JSONB | Minimized inventory |
| core_updates_available | BOOLEAN | Required |
| plugin_updates_count | INTEGER | Default 0 |
| theme_updates_count | INTEGER | Default 0 |
| reported_at | TIMESTAMPTZ | Source timestamp |
| received_at | TIMESTAMPTZ | API receipt timestamp |

Inventory must be validated and size-limited. Do not store plugin settings, API keys, user records, or other unnecessary site content.

## 4.7 monitor_checks

| Column | Type | Notes |
|---|---|---|
| id | UUID | Primary key |
| site_id | UUID | Tenant-owned site |
| monitor_type | TEXT | uptime, ssl |
| checked_at | TIMESTAMPTZ | Required |
| result | TEXT | up, down, warning, error |
| http_status | INTEGER | Nullable |
| latency_ms | INTEGER | Nullable |
| ssl_expires_at | TIMESTAMPTZ | Nullable |
| error_code | TEXT | Nullable |
| details | JSONB | Sanitized diagnostic data |

Avoid unbounded JSON payloads. Never store response bodies by default.

## 4.8 incidents

| Column | Type | Notes |
|---|---|---|
| id | UUID | Primary key |
| site_id | UUID | Tenant-owned site |
| monitor_type | TEXT | uptime, ssl, stale_data |
| status | TEXT | open, acknowledged, resolved |
| severity | TEXT | info, warning, critical |
| started_at | TIMESTAMPTZ | Required |
| resolved_at | TIMESTAMPTZ | Nullable |
| last_notified_at | TIMESTAMPTZ | Nullable |
| fingerprint | TEXT | Deduplication key |
| created_at | TIMESTAMPTZ | Required |

Add a unique constraint or transactional deduplication mechanism for open incidents with the same fingerprint.

## 4.9 notification_endpoints

| Column | Type | Notes |
|---|---|---|
| id | UUID | Primary key |
| organization_id | UUID | Tenant reference |
| type | TEXT | email, bark, slack or telegram |
| destination | TEXT | Normalized email or channel-prefixed credential fingerprint |
| label | TEXT | Nullable display name; required for push/chat channels |
| encrypted_key | TEXT | Nullable AES-256-GCM device key or chat credentials; server-only |
| verified_at | TIMESTAMPTZ | Nullable |
| enabled | BOOLEAN | Default true |
| created_at | TIMESTAMPTZ | Required |

## 4.10 notification_deliveries

| Column | Type | Notes |
|---|---|---|
| id | UUID | Primary key |
| incident_id | UUID | Nullable for recovery events |
| endpoint_id | UUID | Nullable |
| channel | TEXT | email, bark, slack or telegram |
| event_key | TEXT | Idempotency key |
| status | TEXT | queued, sent, failed |
| attempts | INTEGER | Default 0 |
| next_attempt_at | TIMESTAMPTZ | Nullable |
| provider_message_id | TEXT | Nullable |
| last_error_code | TEXT | Nullable |
| created_at | TIMESTAMPTZ | Required |
| sent_at | TIMESTAMPTZ | Nullable |

## 4.11 audit_logs

Record security-sensitive events such as site pairing, credential rotation, site disconnection, login failures, and organization membership changes.

Do not record passwords, API secrets, session tokens, or raw authorization headers.

## 4.12 subscriptions

Store the external billing customer ID, subscription ID, plan, entitlement state, and renewal information.

Billing webhooks must be authenticated and idempotent. The SaaS must not rely exclusively on frontend redirect parameters to grant paid access.

---

# 5. API Specification

Base path: `/api/v1`.

Use JSON request and response bodies, TLS, strict schema validation, request size limits, rate limiting, and structured error codes.

## 5.1 Authentication

- `POST /auth/register`
- `POST /auth/login`
- `POST /auth/logout`
- `POST /auth/password/forgot`
- `POST /auth/password/reset`
- `POST /auth/email/verify`

For browser sessions, use secure, HttpOnly, SameSite cookies. Protect state-changing requests against CSRF.

## 5.2 Organization and Dashboard

- `GET /organizations`
- `POST /organizations`
- `GET /organizations/:organizationId`
- `GET /organizations/:organizationId/dashboard`
- `GET /organizations/:organizationId/usage`

Every route must verify membership and role permissions.

## 5.3 Site Registration

- `GET /organizations/:organizationId/sites`
- `POST /organizations/:organizationId/sites`
- `GET /sites/:siteId`
- `PATCH /sites/:siteId`
- `DELETE /sites/:siteId`
- `POST /sites/:siteId/rotate-credential`
- `POST /sites/:siteId/disconnect`

Site registration must validate the URL and perform SSRF-safe hostname checks.

## 5.4 Site Pairing

- `POST /sites/:siteId/pairing-challenges`
- `POST /connector/pair`
- `POST /connector/heartbeat`
- `POST /connector/inventory`
- `POST /connector/health`

Pairing challenges must be random, short-lived, single-use, and scoped to the target organization and site.

Do not accept arbitrary organization IDs from a plugin and treat them as authorization.

## 5.5 Monitoring

- `GET /sites/:siteId/checks`
- `GET /sites/:siteId/incidents`
- `POST /sites/:siteId/incidents/:incidentId/acknowledge`
- `GET /organizations/:organizationId/incidents`

Monitoring execution should be handled by background workers rather than user-facing API requests.

## 5.6 Notifications

- `GET /organizations/:organizationId/notification-endpoints`
- `POST /organizations/:organizationId/notification-endpoints`
- `POST /organizations/:organizationId/notification-endpoints/bark`
- `POST /organizations/:organizationId/notification-endpoints/slack`
- `POST /organizations/:organizationId/notification-endpoints/telegram`
- `PATCH /organizations/:organizationId/notification-endpoints/:endpointId`
- `DELETE /organizations/:organizationId/notification-endpoints/:endpointId`
- `POST /organizations/:organizationId/notification-endpoints/:endpointId/resend`
- `POST /organizations/:organizationId/notification-endpoints/:endpointId/test`
- `POST /notification-endpoints/verify`

Email addresses and Bark devices must complete a hash-only, single-use possession proof before routine alert delivery. Bark supports multiple labeled devices per organization and uses only the fixed official provider endpoint; arbitrary push URLs and self-hosted Bark servers are outside this milestone. Device keys are encrypted at rest, hidden from API reads and cleared on endpoint deletion.

Slack Incoming Webhooks and Telegram bot/chat destinations also support multiple labeled recipients and the same possession proof, shared 20-endpoint limit, authorization, cooldown, audits and delivery fencing. Slack restricts the exact official webhook host/path; Telegram uses a fixed Bot API host with validated tokens and numeric chat IDs. Chat secrets use an independent stable `NOTIFICATION_ENCRYPTION_KEY` with organization/channel-bound encryption and are hidden on reads and cleared on deletion. These channels do not change incident confirmation timing or guarantee exactly-once provider delivery.

## 5.7 API Error Format

Return a consistent format:

```json
{
  "error": {
    "code": "SITE_NOT_FOUND",
    "message": "The requested site was not found.",
    "requestId": "request-correlation-id"
  }
}
```

Do not expose stack traces, database errors, secret values, or internal network information in production responses.

---

# 6. WordPress Connector Plugin

## 6.1 Plugin Responsibilities

The connector plugin should:

- Pair a WordPress installation with a SitePulse site.
- Send periodic heartbeats.
- Report WordPress core, plugin, and theme update counts.
- Report minimal inventory data.
- Display the connection status.
- Allow credential revocation and disconnection.
- Retry temporary API failures with bounded backoff.

The plugin must not run frequent network calls on every page load.

## 6.2 Plugin Structure

```text
sitepulse-connector/
├── sitepulse-connector.php
├── includes/
│   ├── class-plugin.php
│   ├── class-api-client.php
│   ├── class-pairing.php
│   ├── class-heartbeat.php
│   ├── class-inventory.php
│   ├── class-health.php
│   ├── class-settings.php
│   └── class-logger.php
├── admin/
│   ├── class-admin-page.php
│   └── views/
├── languages/
└── tests/
```

Use the WordPress Settings API and established WordPress hooks. Follow WordPress coding standards.

## 6.3 Pairing Workflow

1. User creates a site in the SaaS.
2. SaaS issues a pairing challenge with a short expiration.
3. User installs the plugin.
4. User enters the pairing code or opens a signed pairing URL.
5. Plugin exchanges the challenge for a site-scoped secret.
6. SaaS invalidates the pairing challenge.
7. Plugin stores its credential securely using WordPress options.
8. Plugin sends a test heartbeat.
9. Dashboard displays the connected status.

The pairing secret must never be included in publicly cacheable URLs, analytics events, or logs.

## 6.4 Heartbeat and Inventory

Initial default heartbeat interval: 15 minutes, configurable within server-enforced limits.

The plugin should report:

- WordPress version.
- PHP version, where appropriate.
- Active plugin identifiers and versions.
- Theme identifiers and versions.
- Available core updates.
- Available plugin updates.
- Available theme updates.
- Connector version.
- Last successful heartbeat.

Inventory should be sent only when needed or when the inventory changes. Enforce payload limits.

The SaaS should use its own clock for receipt timestamps. Do not trust the client timestamp as the sole basis for incident decisions.

## 6.5 WordPress Security Requirements

- Verify WordPress nonces for administrative actions.
- Require appropriate capabilities, such as `manage_options`, for settings changes.
- Sanitize inputs and escape rendered output.
- Use HTTPS for all API communication.
- Do not expose site credentials in HTML, JavaScript, or logs.
- Avoid collecting customer content or personally identifiable information.
- Provide an explicit disconnect function that revokes the server-side credential.
- Delete scheduled events on plugin deactivation or uninstall where appropriate.
- Avoid automatic destructive changes during upgrades.

---

# 7. Monitoring Engine

## 7.1 Uptime Checks

Current responsiveness milestone: default interval is 5 minutes for all paired sites. Operators may configure the global interval from 1–60 minutes through validated environment variables. Plan-specific intervals remain a future entitlement decision; clients cannot choose an interval to bypass server policy.

The monitoring engine should:

1. Validate the hostname.
2. Resolve DNS using a controlled resolver.
3. Reject loopback, private, link-local, and other prohibited address ranges.
4. Connect only to approved public destinations.
5. Disable redirects or revalidate every redirect destination.
6. Enforce connection and total request timeouts.
7. Limit response size.
8. Record status, latency, and sanitized error information.

A single failed request should not immediately create a critical outage.

## 7.2 Incident State Machine

Proposed transitions:

- Healthy → Suspected failure after the first failed check.
- Suspected failure → Down after a second qualifying failed check.
- Down → Recovery pending after a successful check.
- Recovery pending → Resolved after the configured recovery confirmation.
- Any state → Stale data when plugin heartbeats exceed the expected interval.

Persist state transitions transactionally to avoid duplicate incidents.

## 7.3 SSL Monitoring

Check:

- Certificate chain validity.
- Hostname match.
- Expiration date.
- TLS handshake success.
- Remaining days until expiration.

Suggested warning thresholds: 14, 7, and 3 days.

These checks should use the public hostname and should not require the WordPress plugin to provide private keys or certificate contents.

## 7.4 Alert Deduplication

Use an incident fingerprint such as:

`site_id + monitor_type + normalized_failure_category`

Only one open incident should exist for the same fingerprint unless the incident model explicitly supports multiple independent failures.

Send a notification when an incident opens, when severity meaningfully changes, and when it resolves. Apply cooldowns and retry limits.

---

# 8. Frontend Pages

## Public Pages

- `/`
- `/pricing`
- `/features`
- `/security`
- `/privacy`
- `/terms`
- `/contact`

## Authentication

- `/login`
- `/register`
- `/forgot-password`
- `/verify-email`

## Application

- `/app`
- `/app/sites`
- `/app/sites/new`
- `/app/sites/:siteId`
- `/app/incidents`
- `/app/notifications`
- `/app/settings`
- `/app/billing`

## Dashboard Widgets

The main dashboard should display:

- Total connected sites.
- Healthy, degraded, down, and stale sites.
- Sites requiring WordPress updates.
- SSL certificates nearing expiration.
- Open incidents.
- Recent incident history.
- Last successful data receipt.

Use clear labels and accessible status indicators. Do not communicate status through color alone.

---

# 9. Subscription and Billing

## Initial Plans

### Free

- Up to 2 sites.
- Basic uptime monitoring.
- Limited history.
- Email notifications.

### Pro — Proposed price: $12/month

- Up to 10 sites.
- Uptime and SSL monitoring.
- WordPress update inventory.
- Longer history.
- Email alerts.

### Agency — Proposed price: $29/month

- Up to 30 sites.
- Client grouping.
- Maintenance reports.
- Higher monitoring limits.

### Agency Plus — Proposed price: $59/month

- Up to 100 sites.
- Larger history allowance.
- Advanced alert configuration.
- Future team features.

These prices are hypotheses to validate with customers, not established market prices.

## Billing Requirements

- Centralize plan entitlements in the backend.
- Enforce site limits server-side.
- Handle successful payments, failed payments, renewals, cancellations, refunds, and disputes.
- Verify provider webhook signatures.
- Store webhook event IDs for idempotency.
- Provide a grace period for failed renewals.
- Do not immediately delete monitoring history after cancellation.
- Never trust a client-supplied plan name to authorize premium functionality.

Before selecting a payment provider, confirm seller eligibility, payout availability, subscription support, refund handling, and total fees for the actual mainland China business structure.

---

# 10. Security Requirements

Security is a launch requirement, not a later enhancement.

## Authentication and Authorization

- Use a maintained authentication library.
- Hash passwords with an approved password hashing algorithm.
- Apply rate limits to authentication endpoints.
- Use secure session cookies.
- Enforce tenant isolation on every organization-owned resource.
- Add tests attempting cross-tenant data access.

## Site Credentials

- Use high-entropy site secrets.
- Store only hashes where recovery is unnecessary.
- Support credential rotation and revocation.
- Never store WordPress administrator passwords.
- Never log authorization headers.

## SSRF Protection

The URL monitoring engine is a major attack surface.

- Accept only HTTP and HTTPS.
- Reject embedded credentials in URLs.
- Block private, loopback, link-local, multicast, and reserved address ranges.
- Revalidate DNS and redirect destinations.
- Defend against DNS rebinding.
- Enforce request timeouts and response limits.
- Restrict outbound network access where practical.
- Do not permit arbitrary ports without a documented requirement.

## Data Protection

- HTTPS for all external traffic.
- Private database and Redis networking.
- Encrypted backups.
- Managed secrets rather than committed `.env` files.
- Data retention policies.
- Account and organization deletion workflows.
- Privacy policy describing inventory collection and monitoring behavior.

## Operational Security

- Dependency scanning.
- Database migration backups.
- Structured, redacted logs.
- Monitoring for failed jobs.
- Incident response documentation.
- Separate development and production credentials.

---

# 11. Testing Strategy

## Unit Tests

- URL normalization.
- Plan entitlement calculation.
- Incident fingerprint generation.
- Alert deduplication.
- SSL expiration calculations.
- Inventory validation.
- Retry scheduling.

## API Integration Tests

- Registration and login.
- Site creation and pairing.
- Valid and invalid heartbeat.
- Inventory submission.
- Site credential rotation.
- Credential revocation.
- Tenant isolation.
- Billing webhook idempotency.

## WordPress Tests

- Plugin activation and deactivation.
- Pairing success and failure.
- API timeout handling.
- Inventory collection.
- WordPress multisite behavior where supported.
- Capability and nonce checks.
- Credential removal.

## End-to-End Tests

- Register a user.
- Create an organization.
- Add a site.
- Pair a local WordPress test installation.
- Trigger a simulated outage.
- Confirm an incident is created.
- Confirm an alert is queued.
- Restore the test site.
- Confirm recovery notification and dashboard state.

## Security Acceptance Tests

- Attempt to access another organization's site.
- Attempt to reuse an expired pairing challenge.
- Attempt to use a revoked credential.
- Submit a private IP address to the monitor.
- Submit a redirect to a private IP address.
- Send oversized inventory payloads.
- Replay billing webhooks.
- Verify that logs contain no secrets.

---

# 12. Development Roadmap

## Phase 0 — Foundation

- Initialize monorepo.
- Configure TypeScript, linting, formatting, and tests.
- Set up Docker Compose.
- Configure PostgreSQL and migrations.
- Document environment variables.
- Add CI checks.

## Phase 1 — Authentication and Dashboard

- Implement authentication.
- Implement organizations and membership.
- Build the dashboard shell.
- Add tenant-scoped database access.
- Add authorization tests.

## Phase 2 — WordPress Connector

- Implement plugin skeleton.
- Implement pairing challenges.
- Implement credential storage.
- Implement heartbeat.
- Implement inventory collection.
- Test activation and deactivation.

## Phase 3 — Monitoring

- Implement SSRF-safe HTTP checks.
- Implement SSL checks.
- Implement background scheduling.
- Implement incident transitions.
- Add retry and deduplication logic.

## Phase 4 — Notifications

- Configure an email provider.
- Implement verified notification endpoints.
- Implement notification queues.
- Add delivery retries and cooldowns.
- Implement recovery notifications.

## Phase 5 — Billing and Launch

- Add plans and entitlements.
- Integrate one eligible payment provider.
- Implement webhook verification.
- Add pricing and legal pages.
- Deploy staging.
- Complete security acceptance tests.
- Run pilot monitoring for multiple days.
- Launch to the first pilot customers.

Do not implement every phase in one large coding task. Complete and verify each phase before moving on.

---

# 13. Definition of Done

The MVP is ready for pilot launch only when:

1. A user can register and create an organization.
2. A WordPress site can be paired without sharing administrator credentials.
3. The connector can send heartbeats and inventory.
4. The SaaS can detect simulated downtime.
5. SSL expiration checks work against known test certificates and public endpoints.
6. Alerts are deduplicated and recovery notifications are generated.
7. Site credentials can be rotated and revoked.
8. Cross-tenant authorization tests pass.
9. SSRF protection tests pass.
10. Database migrations and backups are documented.
11. Deployment can be reproduced from the repository.
12. The product's privacy and data-retention practices are documented.
13. The first pilot users can complete onboarding without developer intervention.
14. A documented rollback procedure exists for production deployments.

---

# 14. Codex Execution Rules

Codex must:

- Read `AGENTS.md` before making changes.
- Follow the documented architecture and repository structure.
- Implement one milestone at a time.
- Add or update tests with every meaningful feature.
- Never weaken authentication or tenant isolation to make tests pass.
- Never commit secrets or real customer data.
- Never introduce remote WordPress execution into the MVP.
- Never implement URL monitoring without SSRF protections.
- Never change production data or deployment configuration without explicit authorization.
- Update `README.md`, `CHANGELOG.md`, and relevant architecture documents when behavior changes.
- Run formatting, linting, type checking, unit tests, and integration tests where available.
- Report completed work, test results, known limitations, and the next recommended task.

The initial implementation task should be repository scaffolding and authentication, not the entire application in one pass.

**First milestone acceptance:** the application starts locally with Docker Compose, migrations run successfully, authentication works, and organization isolation tests pass.

**Second milestone acceptance:** one test WordPress site can pair and send a heartbeat to the API.

**Third milestone acceptance:** the monitoring worker detects an outage and produces one deduplicated incident.

Only after these milestones are reliable should billing and production onboarding be added.

---

# 15. WordPress security visibility milestone

The product now includes a deliberately bounded, read-only security visibility milestone. It may collect installed plugin/theme identifiers and versions, active/update state, selected non-secret WordPress environment flags, and local rule IDs with paths relative to `wp-content`. It may match those components against a fixed public advisory provider from the worker.

This milestone must preserve tenant membership authorization and Connector site credentials. It must expose complete, partial, stale, unavailable and unknown coverage rather than equating missing findings with safety. It must not upload source contents, introduce remote execution, modify WordPress files, auto-update components, quarantine/delete code, inspect customer database content, or claim antivirus/integrity certification. Resource limits and provider privacy/availability limitations must be documented and tested.

# 16. Opt-in WordPress software management milestone

Following explicit product-owner authorization, SitePulse may install, uninstall, activate, deactivate and update plugins/themes and perform the same specified plugin operation across at most 20 selected sites. This is separate from foundation and read-only security scanning. The earlier MVP remote-update/install exclusions do not prohibit this later, explicitly authorized milestone.

Use a tenant-scoped PostgreSQL queue, verified owner/admin membership, mandatory preview/confirmation/reason, per-site serialization and audit records. Current site credentials authenticate Connector pull/result endpoints. WordPress administrators must explicitly enable management locally, with nonce/capability protection and current-user capability rechecks. Official WordPress.org packages remain the default source; the only uploaded-package exception is the separately authorized, bounded and scanned library in section 17. No arbitrary URL, shell, SQL, PHP editing or generic code execution API is permitted. Protect Connector self-management, active components and declared dependencies. Theme deactivation switches to a specified replacement. Preserve SSRF controls, sanitized logging, tenant isolation and immutable migrations.

The direct graphical manager shows site selection, installed versions/active/update states, official plugin icons with safe fallback, impact preview and individual results. Ambiguous outcomes never automatically rerun mutations; the operator must inspect WordPress before releasing uncertain work. Backups, Cron timing, compatibility and absent automatic rollback are explained before confirmation. See `docs/SOFTWARE_MANAGEMENT.md` for API, security boundaries and staging acceptance.

# 17. Scanned package library and code-risk visibility milestone

The authorized library requires personal Google Drive storage for new uploads. PostgreSQL retains metadata, scan result, original uploader/Google account binding and SHA-256, with no new ZIP bytes. Missing configuration, connection or provider availability blocks creation without a database fallback. Existing database packages retain read/install compatibility and identical ZIPs reuse existing entries; automatic migration/deletion is outside this change. Quotas and installation protocol remain unchanged. The original Drive storage owner must remain a verified workspace administrator, and every download verifies the originally scanned bytes. No public sharing or arbitrary URL fetch is introduced. See `GOOGLE_DRIVE_STORAGE.md` for lifecycle and deployment requirements.

Following explicit product-owner authorization, verified workspace owners/admins may upload plugin or theme ZIP files to a tenant-scoped reusable package library and install a saved package on selected sites through the same preview, confirmation, reason, queue and audit controls as official packages. A separate local WordPress administrator opt-in is required for package delivery; enabling ordinary remote management does not implicitly enable uploaded package installation.

The library accepts at most 8 MiB per ZIP, 100 packages and 64 MiB of raw ZIP data per workspace. New package bytes are stored in the uploading user's private Google Drive, with transient API scanning/delivery and no durable local copy. Uploads must contain one matching WordPress plugin/theme root, use a bounded ordinary ZIP structure and pass server-side static inspection before they can be installed. Findings, stale scanner versions, invalid archive structures and nested executable/archive payloads block installation. No finding is an antivirus result or proof of safety.

Package bytes are never exposed through a public URL. A short-lived, site-bound running-operation lease permits only the intended Connector credential to fetch the already-approved package; the API rechecks tenant actor authority, local opt-in, operation generation, scan result, size and hash. The Connector downloads through its paired HTTPS origin with TLS verification and no redirects, rechecks consent and SHA-256, uses WordPress native upgraders and deletes the temporary file. Updates remain restricted to the normal official WordPress.org flow in this milestone.

Connected-site code visibility remains bounded and read-only. The Connector scans selected PHP-like and JavaScript files locally and uploads only rule identifiers and paths relative to `wp-content`, never source contents. Uploaded library packages are scanned server-side because their bytes were explicitly provided for storage. Both mechanisms are heuristic, limited and require human review; neither provides malware certification, full vulnerability discovery, integrity verification, quarantine or remediation.

# 18. Malware Detection milestone

Following explicit product-owner authorization and completion of the preceding security visibility and package-library work, SitePulse may add a dedicated Malware Detection capability. This is a later implementation milestone and does not change the current MVP exclusion of malware scanning.

The milestone may combine two bounded detection paths:

- A versioned, reviewable feature and signature ruleset for Connector-side scanning of selected PHP, JavaScript, HTML and related WordPress files. Rules may identify webshell-like execution, obfuscation, encoded payloads, suspicious remote fetch-and-execute behavior, persistence indicators and other high-confidence code-risk patterns.
- Server-side scanning of administrator-provided ZIP files, backups or other explicitly uploaded artifacts using approved engines such as YARA-compatible rules and a malware scanner. Uploaded bytes must remain tenant-scoped and must never be fetched from arbitrary URLs or executed.

Malware data sources must be documented per rule or engine, including provider or project name, version, update cadence, license, attribution, confidence and known limitations. External reputation or hash lookups may be added only through fixed HTTPS providers with bounded requests, privacy review, timeout/size limits and an operator-controlled disable switch. Public vulnerability feeds such as WPVulnerability remain advisory sources and must not be presented as malware signatures.

The Connector path must continue to upload only rule IDs, rule-set version, severity, confidence, normalized relative paths and scan metadata. It must not upload source contents, credentials, absolute paths or customer database data. A compromised WordPress installation may falsify its own local result, so the product must show the trust boundary and distinguish `clean`, `matched`, `partial`, `stale`, `unavailable` and `unknown`; `clean` must never mean safe or certified.

The milestone must define hard resource limits for file count, file size, archive expansion, recursion depth, CPU time, memory, findings and concurrent scans. Findings require human review and must not automatically delete, modify, quarantine or remediate customer code. Any quarantine workflow requires a separate authorization, reversible storage, restore controls, audit records and an explicit recovery procedure.

Before release, acceptance must cover benign fixtures, representative obfuscated-risk fixtures, false-positive review, truncated and partial scans, stale rule-set handling, provider failure, disable-switch behavior, tenant isolation, sanitized logging, retention/deletion, backup growth and deployment rollback. Never use real malware, production customer code or credentials in tests or acceptance evidence. Documentation must state that the feature is a risk-detection aid rather than antivirus certification, complete vulnerability discovery or a guarantee that a site is uncompromised.

# 19. Authorized Google PageSpeed performance milestone

Following product-owner authorization, the platform may use one server-side API key to request mobile/desktop Lighthouse lab reports from Google PageSpeed Insights for connected sites' registered entry pages. This is independent of Site Kit, GA4, Search Console and customer OAuth; field Core Web Vitals are excluded. Preserve tenant membership, verified owner/admin mutations, trusted Origin, public URL validation, bounded provider requests, durable leases and shared daily reservations. Display timestamps, unavailable/stale/failed states and previous successful reports honestly. Keep the feature disabled until operator configuration, document Google URL disclosure and retention, and apply only the additive migration through the authorized backup/deployment process. See [PERFORMANCE.md](PERFORMANCE.md).
