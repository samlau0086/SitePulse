# Database and migrations

Migration `0017_bored_sunspot.sql` adds attachment storage and Google Drive account/file references, making legacy `zip_base64` nullable with a constraint matching each storage type. Migration `0018_flawless_veda.sql` changes the default to `google_drive` without rewriting existing rows. New API uploads always use Drive references with null ZIP bytes; legacy database bytes remain readable and are not automatically migrated or deleted. See [Drive storage](GOOGLE_DRIVE_STORAGE.md) for configuration and lifecycle requirements.

Migration `0015_high_living_mummy.sql` adds `users.time_zone`, non-null text defaulting to `UTC`, including existing users. The API validates named IANA zones before updates scoped to the authenticated user's ID. This is a personal display preference; timestamps remain `timestamptz` and ISO/UTC on the API. Back up production and obtain explicit authorization before applying migrations.

Migration `0006_tearful_morlocks.sql` adds nullable `organizations.site_limit_override` (0–1000) and `agency_plus`. Existing sites, credentials and jobs are unchanged. Quota decisions and manual entitlement updates serialize on the organization row; see [ENTITLEMENTS.md](ENTITLEMENTS.md). Existing migrations remain immutable.

Migration `0007_neat_morlun.sql` adds `notification_settings`, `notification_endpoints`, and tenant/endpoint references on `notification_deliveries`. It backfills the organization of existing incident deliveries through the incident's site before adding foreign keys. Old orphan history remains nullable and fails closed in the worker. Active managed addresses are unique per workspace; deleted rows remain as tombstones so an address cannot silently fall back to automatic member delivery. Existing migrations remain immutable.

All IDs are UUIDs. Timestamps are `timestamptz`; PostgreSQL stores instants, and API serialization uses ISO timestamps. Database connections and API transport use UTC; the UI formats instants in the user's saved time zone. Email is normalized to lowercase and trimmed by the API and constrained in SQL; uniqueness is enforced by the database.

| Table                     | Purpose and constraints                                                                                             |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `users`                   | Unique normalized email; Better Auth profile and verification fields                                                |
| `auth_accounts`           | Auth-library credential accounts; unique provider/account; Argon2id `password_hash`; FK to users                    |
| `auth_sessions`           | Signed-cookie lookup tokens, expirations, user FK; user/expiry indexes                                              |
| `auth_verifications`      | Better Auth verification/reset lifecycle records                                                                    |
| `organizations`           | Unique validated slug; owner FK; plan check and default free                                                        |
| `organization_members`    | Composite organization/user PK, constrained owner/admin/member role, user index, at most one owner per organization |
| `audit_logs`              | Nullable organization and actor FKs; action, request ID, timestamps, allowlisted metadata; tenant/time index        |
| `sites`                   | Organization FK, immutable canonical identity, partial unique org/URL for undeleted rows; heartbeat freshness       |
| `site_credentials`        | One credential hash per site, unique hash, rotation version, revocation timestamp, monotonic sequence               |
| `pairing_challenges`      | Site FK, unique random-code hash, expiration and consumption timestamps                                             |
| `notification_settings`   | Per-workspace verified-member default and persisted verification/test mail allowance                                |
| `notification_endpoints`  | Managed normalized email recipients, enable/verification state, expiring proof hash and deletion tombstone          |
| `notification_deliveries` | Durable incident/recovery outbox, tenant and optional managed-recipient identity, leases and delivery outcome       |
| `software_attachments`    | Tenant-scoped Drive references, metadata, SHA-256, bounded scan result and legacy database ZIP bytes                |

The service ensures the owner gets a matching owner membership in the creation transaction. No membership administration is exposed. Direct administrative SQL must preserve this invariant; the database does not enforce that every organization has an owner membership. User deletion is restricted for organization owners; an account deletion/ownership transfer workflow is not implemented. Audit organization deletion is restricted to preserve security history; retention and deletion need an explicit policy before launch.

The schema lives in `packages/database/schema/index.ts`. Generate SQL with `pnpm db:generate`; inspect and commit SQL plus Drizzle snapshots/journal. Apply with `pnpm db:migrate` after preparing `.env`. The migration CLI validates `DATABASE_URL` and closes its connection pool. Container deployments run the same helper in a one-shot migration service. Only one migration runner should operate at a time.

`0001_windy_guardsmen.sql` adds sites, credentials and challenges; the foundation migration remains unchanged. Site deletion is soft, with immediate credential/challenge revocation. Re-registering a deleted URL creates a new site identity. A challenge issuance replaces older challenges for that site. Auth-library reset tokens and WP local options remain sensitive: restrict DB access and encrypt backups. Production migration execution requires separate authorization and a verified backup.

Migrations use the Drizzle PostgreSQL migrator and its `drizzle.__drizzle_migrations` ledger. Re-running applied migrations is a no-op. Never edit an already applied migration: create a follow-up. The integration suite applies the migration twice against a disposable database and then exercises real queries and transactions.

`0002_minimal_inventory.sql` adds the latest inventory snapshot per site. Its journal entry and `meta/0002_snapshot.json` must accompany the SQL; an unregistered SQL file is ignored by the migrator. Unit tests reject missing journal entries or snapshots, and integration tests cover empty inventory reads, snapshot replacement, server receipt times and authorization.

`0003_external_monitoring.sql` adds `monitor_jobs` (unique site/type, due times, lease token/expiry and consecutive-result counters), `monitor_checks` (bounded sanitized results, site/time index), and `incidents` (open/acknowledged/resolved, severity, fingerprint, timestamps and resolution reason). A partial unique fingerprint index prevents duplicate active incidents. SSL and HTTP jobs remain independent of connector freshness. Connection changes delete jobs and close active incidents as `connection_reset`; old checks remain until retention cleanup. The worker deletes up to 500 checks older than 30 days and 500 resolved incidents older than 90 days per sweep; open incidents remain. Migration SQL, journal and snapshot ship together. Integration tests cover repeat migrations, leases, stale completion, acknowledgement, outage/recovery and tenant isolation.

`0004_cold_zemo.sql` adds the durable `notification_deliveries` outbox. Incident-open and confirmed-recovery events enqueue one delivery per verified organization member in the same transaction as the incident transition. Unique event keys prevent duplicate queue rows. `0005_strange_nocturne.sql` adds the lease token used to fence stale workers. Workers claim rows with `SKIP LOCKED` and short leases, then send outside the transaction. Attempts, retry time, provider message ID, terminal status and sanitized error code are persisted; deliveries stop after eight attempts. Deleting an incident does not erase delivery history.

`0012_tidy_sir_ram.sql` adds the tenant-scoped software operation queue and management capability state. `0013_nappy_shinko_yamashiro.sql` adds explicit inventory synchronization state. `0014_dear_wrecker.sql` adds `software_attachments` and the independent `site_management.package_support` opt-in. Attachments use an organization/SHA-256 unique key, cascade with organization deletion and retain their authenticated uploader through a restricted user FK. The initial library stored base64 ZIP bytes in PostgreSQL; only legacy entries now use this storage. The API enforces 8 MiB per package, 100 packages and 64 MiB raw data per workspace across all entries. Legacy base64 increases stored size by about 33% before table/index/backup overhead. New ZIPs reside only in Drive. Reads never return `zip_base64`; package delivery uses a site-bound running-operation lease. Existing migrations remain immutable.

Do not run migrations against production without authorization, a verified backup, and compatibility review. Prefer forward fixes. Destructive schema rollback requires a controlled restore to a separate database, verification, and a planned cutover; see DEPLOYMENT.md. Row-level security is not enabled: isolation is enforced by API query predicates and role checks, with regression tests. Any future direct database consumer must enforce equivalent isolation or add RLS.

# Email branding migration

Migration `0016_rainy_frog_thor.sql` adds optional account email brand/logo columns and the `platform_branding` singleton. It does not alter applied migrations. See [EMAIL_BRANDING.md](EMAIL_BRANDING.md) for resolution and backup-first rollout.
