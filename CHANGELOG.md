# Changelog

## Unreleased — Sync details alignment

- Keep the software site card's Sync details clock icon inline with its disclosure arrow and label instead of splitting the control across multiple lines.

## Unreleased — Personal Google Drive attachment storage

- Set the Next.js upload proxy limit to 9 MB so valid 8 MiB ZIPs are not dropped before reaching the API, and show an actionable message when an upstream proxy blocks the request.
- Replace the attachment file chooser with an accessible drag-and-drop ZIP target that displays the selected file and still requires explicit upload-and-scan submission.
- Require personal Google Drive for all new attachment uploads, using Better Auth linking, encrypted OAuth tokens and `drive.file` permissions. Remove the storage selector and disable uploads until connected. Reject explicit database storage and never fall back to SitePulse ZIP storage when Drive is unavailable.
- Preserve database attachments and the original Connector protocol. Proxy Drive downloads through tenant/site leases and verify size/SHA-256; bind files to the original Google account and recheck the uploader's verified administrator membership.
- Add migration 0017 for Drive references and migration 0018 for the Drive storage default, paired OAuth configuration and deployment wiring. Unconfigured servers retain legacy reads but cannot create uploads. Deletion/disconnection retains Drive originals; existing bytes are not migrated. See `docs/GOOGLE_DRIVE_STORAGE.md` for setup and acceptance limits.

## Unreleased — Persistent software queue feedback

- Keep software actions, bulk targets and installation submission blocked per site while operations are queued, running or unknown. Show the action and queue state beside installed versions, retaining server-reported inventory.
- Preserve acknowledged queue state if result reload fails and discard older in-flight polling responses. Polling and page reloads derive controls from outstanding operations; terminal results release controls and unknown outcomes require existing manual review.
- Include outstanding operations alongside the latest 100 history entries so previews cannot hide live locks. Add interaction and tenant-scoped API regression tests; no migration or Connector change.

## Unreleased — Site information at a glance

- Add directory counts for matching HTTP-up sites, security-review sites and active Connectors, with direct monitoring/security links and separate hostname/workspace identity.
- Add reported plugin, theme and available-update counts to software site cards; preserve missing inventory as unknown, visible sync failures and last-success data. Move poll/request/attempt timestamps into accessible Sync details disclosures.
- Use compact date/time displays with seconds and instant-specific offsets, a shared zone label, full localized/UTC tooltips and accessible full timestamps. No API, migration or Connector changes.

## Unreleased — Incident filter display

- Replace the single-site incident status dropdown with visible All statuses / Active / Resolved filter buttons to avoid clipped native popup text. Reuse the shared selected/focus styles and 44px targets, wrap on narrow screens and reset pagination when changing filters.

## Unreleased — Consistent UTC labels

- Normalize zero-offset timestamp labels to `GMT` across ICU/runtime versions, fixing the Linux CI time-format assertion while preserving fractional offsets and daylight-saving behavior. Add regression coverage for alternative zero-offset labels.

## Unreleased — Branded HTML email

- Add shared responsive HTML templates with a brand header, explicit event state, action button and fallback link, retaining plain text for authentication, recipient verification/tests and incident/recovery emails.
- Add allowlisted, verified platform administrator email branding settings and account-owned Agency/Agency Plus white-label logos. Resolve the current workspace plan on delivery; Free/Pro, unconfigured Agency and account authentication mail use the platform brand.
- Add Preferences branding controls, logo previews, strict HTTPS URL validation, audited changes and migration `0016_rainy_frog_thor.sql`. The sending identity remains operator-configured.

## Unreleased — Security filters and software site cards

- Keep severity filters on neutral surfaces with readable counts and a distinct selected border; prevent primary-button styles from overriding the filters.
- Reorganize software site cards into identity/readiness, timestamp metadata and a compact sync footer. Remove the redundant selection checkbox in single-site views and move Connector setup guidance into a disclosure.

## Unreleased — User time zones

- Add account-level IANA time zone preferences with a UTC default and explicit browser-zone selection. Persist through a session-protected self-service endpoint; reject invalid zones and client-supplied user IDs.
- Render operational timestamps consistently in the saved zone with full date, seconds, UTC offset and zone name, including daylight-saving changes. Keep ISO/UTC values in time elements and tooltips; storage, monitoring schedules and notification delivery are unchanged.
- Add immutable migration `0015_high_living_mummy.sql` for `users.time_zone`; back up before authorized production migration.

## Unreleased — Compact site operations

- Replace long monitoring lists with HTTP/SSL status cards, check/incident switching, five-record pagination, incident status filters and readable UTC times. Preserve confirmation semantics and acknowledgement permissions.
- Scope the single-site Plugins & themes destination to that site's inventory, sync controls and operation history. Retain a direct cross-site management link and shared icon-based segmented site navigation.

## Unreleased — Security filtering and advisory clarity

- Make Critical/High/Medium/Low/Unknown summary tiles accessible toggle filters for environment risks and public advisories, with visible filter state, section result counts and a clear action. Unscored local indicators and coverage warnings remain visible.
- Remove only byte-for-byte equivalent advisory records. Group distinct advisory IDs that share the same component, title, severity and fixed boundary into a compact card with expandable IDs and source links, so generic provider titles no longer appear as indistinguishable duplicate cards.

## Unreleased — Site directory health

- Show independent HTTP UP/DOWN, first-failure/recovery confirmation, pending/overdue/disabled monitoring and security summaries in the full directory and overview cards. Retain Connector heartbeat, unresolved counts and direct actions.
- Aggregate persisted HTTP and security data inside the existing membership-protected organization list, without per-site requests or exposing raw findings. Reuse detail-view security assessment rules, retain stale/incomplete warnings and add state-rendering and tenant-isolation regression tests. No migration or Connector update required.

## Unreleased — Security assessment clarity

- Replace dense security lists with severity-sorted finding cards, filled/tinted Critical/High/Medium/Low/Unknown badges and explicit environment/advisory counts. Keep local indicators unscored and coverage independent from findings.
- Add review recommendations for environment settings, local code indicators and PHP/WordPress/plugin/theme advisories, including missing-patch and supply-chain cases. Preserve read-only assessment, tenant permissions and incomplete/stale scan warnings; no automatic remediation or migration.

## Unreleased — Scanned attachment library

- Detect attachment folder slugs from the unique validated ZIP root during server scanning; remove manual slug entry and use the kind-only upload endpoint. Retain malformed, multiple-root and protected-package rejection.
- Add a tenant-scoped reusable plugin/theme ZIP library with verified owner/admin uploads, member metadata reads, SHA-256 deduplication, audited deletion and migration 0014. Enforce 8 MiB per package, 100 packages and 64 MiB raw data per workspace; store immutable package bytes in PostgreSQL for the initial small-library deployment and document base64/backup growth.
- Add bounded ZIP structure validation and static PHP/JavaScript/HTML/SVG risk indicators. Block malformed archives, protected Connector packages, nested archives/executables, stale scanner results and packages with findings from installation. A clean result is explicitly not an antivirus, vulnerability or compatibility guarantee.
- Add Attachment library UI, quota/fingerprint/scan visibility and a scanned-upload source in the existing preview/confirmation/bulk workflow. Package reads never expose bytes or arbitrary uploaded artwork; tenant members remain read-only.
- Add Connector 0.4.0 independent uploaded-package consent, capability reporting, site-bound short-lived package delivery and WordPress-native installation. Recheck actor authority, local consent, operation generation, size and SHA-256; use paired HTTPS with no redirects and always remove temporary files. Updates remain WordPress.org-only.
- Refresh the bounded connected-site code scan on explicit inventory synchronization and include selected JavaScript indicators while continuing to upload only rule IDs and relative paths. Preserve tenant isolation, sanitized logs, SSRF protections and existing notification/monitoring behavior.
- Raise the example reverse-proxy request cap to 9 MB so the API's exact 8 MiB ZIP bound can pass, and add API/database/security/UI/deployment documentation plus scanner, authorization, package-lease and Connector regression coverage. Live staging WordPress upgrader acceptance remains required.

## Unreleased — Software action interactions

- Fix confirmation dialogs appearing in the viewport's top-left after the CSS reset; explicitly center them while retaining small-screen margins and internal scrolling.
- Separate direct plugin/theme actions from bulk preparation: action buttons open an accessible native confirmation dialog and queue only the approved component/targets; cancellation never confirms execution.
- Add component checkboxes, visible-result selection, selection counts, removal and a distinct Add to bulk arrow. Protect the Connector and exclude ineligible action targets; keep read-only access disabled.
- Coordinate up to 20 selected components through existing server batches sequentially, waiting for successful results and fresh inventory before revalidating the next target. Stop unsubmitted work on failures, uncertainty, changes or navigation without mutation retries; keep durable queued work visible.
- Add DOM interaction and serial coordinator regression coverage; document browser lifetime, Cron delivery and non-atomic bulk limitations. No API authorization, Connector protocol or database migration changes.

## Unreleased — Inventory synchronization

- Connector 0.3.1 queues inventory immediately after upgrade/reactivation and enabling management; inventory exceptions no longer interrupt heartbeat scheduling. Serialize collection and retain sanitized local failures separately from heartbeat health.
- Add verified tenant-admin read-only inventory sync requests, per-site deduplication/cooldown, credential-generation fencing and fifteen-minute timeout visibility (migration 0013). Connector pulls sync requests even when remote mutations are disabled; inventory work and software execution are never leased together.
- Add per-site Sync inventory actions, distinguish Reload results from collection, and show never-synced, waiting, accepted, failed and timed-out states with retained last-success data. Only an accepted upload establishes inventory success.

## Unreleased — WordPress software management

- Add a direct Plugins & themes workspace destination with site selection, official plugin icons with fallback, installed versions, active/update states, preview confirmation and per-site results.
- Add tenant-scoped PostgreSQL operation queue (migration 0012); verified owner/admin authorization, audit reasons, credential/membership fencing, bounded batches, per-site serialization and sanitized results.
- Connector 0.3.0 supports opt-in plugin/theme install, update, activation, deactivation and uninstall with WordPress-native APIs. Only official packages, direct filesystem access and single-site WordPress are supported. Protect the Connector, active components and dependencies; theme deactivation switches to a replacement.
- Reserve operations durably before mutation, retry acknowledgements without repeating execution, and require review of uncertain outcomes. Document WordPress backup, Cron and acceptance requirements.

## Unreleased — 2026-10-28

- Fixed the SSH deployment verification harness's fresh-root loop scope so Linux CI can check every directory's permissions without a `ReferenceError`.

- Added Connector 0.2.0 full installed plugin/theme inventory, environment risk flags and a bounded, cached, read-only local PHP risk-indicator scan. Only rule IDs and relative paths are reported; no file contents are uploaded or changed.
- Added tenant-scoped Security views, migration 0011 security assessments, fixed-endpoint WPVulnerability matching for WordPress/PHP/recognized WordPress.org components, explicit stale/partial/unknown coverage and an operator disable switch.
- Added conservative version-range, malformed-provider, contract, tenant-isolation and navigation coverage plus a staging runbook. Custom packages and a clean bounded scan are not claimed safe; real Slack/Telegram provider acceptance remains deferred.

- Added multiple Slack Incoming Webhook and Telegram Bot recipients per workspace, encrypted credentials, explicit destination opt-in, tests and enable/disable/delete controls. Both channels share existing tenant authorization, recipient limits, cooldowns and incident/recovery outbox policy.
- Added migration 0010, optional stable `NOTIFICATION_ENCRYPTION_KEY` in validated API/worker/GitHub deployment configuration, fixed official provider destinations, redirect rejection, bounded responses and sanitized retries. Each channel claims up to five deliveries per sweep. Provider timeout/crash retries may duplicate a chat message; provider acceptance is not recipient delivery confirmation.
- Added contracts, provider, encryption, UI and PostgreSQL integration coverage for both channels. Real Slack/Telegram delivery still requires staging acceptance with operator-owned destinations.

## Unreleased — 2026-10-27

- Added multiple verified Bark devices per workspace, encrypted device-key storage, test pushes, enable/disable/delete controls, and Bark delivery for incident and Connector opening/recovery events. The official Bark service is the only supported endpoint in this milestone.
- Added migration 0009 channel metadata, shared recipient limits/rate budgets, per-channel worker batches, bounded Bark retries and sanitized provider errors. Added contract, crypto, UI and PostgreSQL integration coverage for opt-in, tenant isolation, deduplication, secret handling and retry behavior.

- Optimized monitoring responsiveness: default HTTP interval 300 seconds with validated operator bounds 60–3600, propagated through Compose/GitHub deployment, and bounded shortening of existing healthy schedules. Kept 60-second first-failure/recovery confirmation and exposed clearer first/confirmed-failure labels.
- Added independent Connector `stale_data` warning incidents, deduplicated recipient-policy-aware opening/recovery notifications, valid-heartbeat-only recovery and migration 0008. Preserved reset semantics, SSRF controls and server tenant checks; added schedule, delay, duplicate, replay, reset and UI/mail regression coverage.

- Added workspace notification settings and recipient management with independent server membership/verified-owner/admin authorization, normalized verified email recipients, explicit confirmation pages, resend, enable/disable/delete and bounded test emails.
- Added migration 0007, persisted mail cooldown/budgets, hash-only single-use opt-in proofs, security audits, automatic-member preferences and deduplicated recipient selection. Worker rechecks current eligibility before provider handoff and suppresses revoked recipients, including pending retries.
- Added contracts, UI and transactional integration coverage for authorization, cross-tenant access, verification/replay/expiry, mail limits, deduplication, pending recipients and queued-mail suppression. Payments and advanced notification policies remain excluded.

- Added graphical UP / DOWN incident signals with visible text, preserved lifecycle statuses, and reused the signals in site history. Distinguished SSL certificate issues and unverified connection-reset closures from HTTP recovery; historical outcomes do not assert current availability.

- Removed the active sidebar item's trailing dot to avoid confusion with unread/pending notifications. Selection retains blue text/icons, a light blue background and `aria-current`.

- Replaced the blank workspace loading message with route-specific skeleton screens for overview metrics/panels, directories, workspace cards, details and forms. Preserved app navigation, added an accessible loading announcement and respected reduced-motion preferences.

- Reworked the product visual direction from terminal-style typography and ASCII markers to system sans-serif, shared SVG icons, blue primary controls, rounded cards and clearer navigation. Added a real-data connector distribution chart with full count legend and actionable attention items; overview sites now use cards with direct section links. Preserved full-directory filters, authentication, membership checks and mutation behavior. Updated the design source of truth and palette/summary coverage.

- Improved shared UI visibility with stronger input/action borders, bold 44px controls, visible product links, persistent navigation selection, high-contrast focus outlines and distinct semantic status badges. Added tinted error/information/warning panels, separated connector errors from feedback, and visually distinguished destructive connector controls without changing authorization or confirmations. Added palette contrast regression tests.

- Added a server-authorized platform workspace directory, plan/usage views and inline plan/custom-allowance editing with required reasons and impact previews.
- Added validated `PLATFORM_ADMIN_USER_IDS` UUID allowlist, disabled by default, wired through Compose and GitHub deployment; organization owner/admin roles cannot elevate themselves.
- Added transactional audit actors and snapshot conflict checks, preserving tenant isolation and monitoring without database migrations.
- Added permission, search/pagination, preview, audit, override/downgrade, concurrent-save, configuration and page-guard regression tests; documented setup and APIs.

## Unreleased — 2026-10-25

- Added server-enforced site allowances (Free 2, Pro 10, Agency 30, Agency Plus 100), per-organization overrides, tenant-scoped usage, concurrent quota locking and safe API restoration. Downgrades retain existing monitoring. Added an audited operator CLI, workspace/add-site usage UI, migration 0006 and quota/isolation/concurrency tests. Payments remain deferred.

- Added a staging email acceptance runbook with environment configuration, controlled incident/recovery checks, privacy-preserving read-only SQL, isolated retry testing and an explicit pending evidence template. Live provider/mailbox acceptance remains unexecuted.

- Added incident-open and recovery email alerts through a durable, tenant-scoped PostgreSQL outbox. Verified organization members receive deduplicated messages; worker leases, Resend idempotency keys, bounded retries, sanitized delivery state, local file transport, migration 0004 and staging acceptance documentation are included.
- Applied DESIGN.md across the homepage, authentication and operational workspace: shared cream/ink tokens, monospace type, flat bordered sections, ASCII navigation/status markers, monochrome controls and responsive layouts. Added a clearly labeled illustrative homepage preview and retained session-aware actions.
- Made DESIGN.md and UI implementation guidelines mandatory for future UI work through AGENTS.md; documented font fallback and accessible interaction requirements.

## Unreleased — 2026-10-24

- Replaced organization-first navigation with a responsive workspace sidebar, operational overview, searchable cross-workspace site directory, incident center, and direct monitoring/inventory/connection tabs. Added a standalone add-site flow, loading/error states, clearer connector labels and destructive credential confirmations; preserved server membership and verified administrator checks.

- Added external HTTP availability and SSL expiry monitoring with connection-time public-IP pinning, redirect/DNS revalidation, TLS hostname verification and bounded probes that discard response bodies.
- Added migration 0003 for leased PostgreSQL jobs, retained check history and deduplicated incidents; two failures confirm an outage and two successes confirm recovery. Disconnect/rotation/re-pair fences stale results and closes incidents without claiming recovery.
- Added tenant-scoped check/incident APIs, verified administrator acknowledgement, site monitoring panels, organization incidents and validated deployment settings. Added SSRF, real HTTP/TLS and transactional outage/isolation regression tests. Live HTTPS/WordPress acceptance remains pending; no alerts or production deployment are included.

- Made the homepage session-aware and redirected authenticated visitors from login/registration to their workspace, using uncached server session validation.

- Fixed missing Drizzle registration and schema snapshot for inventory migration 0002, which caused site detail reads to fail with HTTP 500. Added migration metadata, idempotency, inventory write/read and tenant/credential isolation regression coverage.

- Documented Windows commands and provider setup for all GitHub deployment settings, including independent secret generation, age backup public-key extraction outside the repository, Resend credentials, environment placement and validation troubleshooting.
- Documented Cloudflare 525 troubleshooting: TLS terminates at the HTTPS reverse proxy while the selected SitePulse host port remains plain HTTP, and rerunning deployment after proxy correction.
- Automate first-deployment VPS configuration from GitHub Environment secrets/variables: validate before SSH, transfer secrets separately through SSH stdin, install mode-600 config under the deployment lock, and reject implicit database credential changes. Automatically install missing age/curl/flock helpers for Debian/Ubuntu root deployments; added configuration and first-run regression checks.
- Automatically create VPS deployment directories over SSH with private permissions for new directories, preserving existing data/permissions and retaining required configuration checks; added creation, repeat-run and blocked-path regression coverage.
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
- Added minimized site inventory snapshots with credential-scoped connector writes, membership-scoped reads, and WordPress/PHP/plugin/theme/update-count reporting.
