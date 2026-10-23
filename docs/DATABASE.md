# Database and migrations

All IDs are UUIDs. Timestamps are `timestamptz`; PostgreSQL stores instants, and API serialization uses ISO timestamps. Production clients should use UTC. Email is normalized to lowercase and trimmed by the API and constrained in SQL; uniqueness is enforced by the database.

| Table                  | Purpose and constraints                                                                                             |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `users`                | Unique normalized email; Better Auth profile and verification fields                                                |
| `auth_accounts`        | Auth-library credential accounts; unique provider/account; Argon2id `password_hash`; FK to users                    |
| `auth_sessions`        | Signed-cookie lookup tokens, expirations, user FK; user/expiry indexes                                              |
| `auth_verifications`   | Better Auth verification/reset lifecycle records                                                                    |
| `organizations`        | Unique validated slug; owner FK; plan check and default free                                                        |
| `organization_members` | Composite organization/user PK, constrained owner/admin/member role, user index, at most one owner per organization |
| `audit_logs`           | Nullable organization and actor FKs; action, request ID, timestamps, allowlisted metadata; tenant/time index        |
| `sites`                | Organization FK, immutable canonical identity, partial unique org/URL for undeleted rows; heartbeat freshness       |
| `site_credentials`     | One credential hash per site, unique hash, rotation version, revocation timestamp, monotonic sequence               |
| `pairing_challenges`   | Site FK, unique random-code hash, expiration and consumption timestamps                                             |

The service ensures the owner gets a matching owner membership in the creation transaction. No membership administration is exposed. Direct administrative SQL must preserve this invariant; the database does not enforce that every organization has an owner membership. User deletion is restricted for organization owners; an account deletion/ownership transfer workflow is not implemented. Audit organization deletion is restricted to preserve security history; retention and deletion need an explicit policy before launch.

The schema lives in `packages/database/schema/index.ts`. Generate SQL with `pnpm db:generate`; inspect and commit SQL plus Drizzle snapshots/journal. Apply with `pnpm db:migrate` after preparing `.env`. The migration CLI validates `DATABASE_URL` and closes its connection pool. Container deployments run the same helper in a one-shot migration service. Only one migration runner should operate at a time.

`0001_windy_guardsmen.sql` adds sites, credentials and challenges; the foundation migration remains unchanged. Site deletion is soft, with immediate credential/challenge revocation. Re-registering a deleted URL creates a new site identity. A challenge issuance replaces older challenges for that site. Auth-library reset tokens and WP local options remain sensitive: restrict DB access and encrypt backups. Production migration execution requires separate authorization and a verified backup.

Migrations use the Drizzle PostgreSQL migrator and its `drizzle.__drizzle_migrations` ledger. Re-running applied migrations is a no-op. Never edit an already applied migration: create a follow-up. The integration suite applies the migration twice against a disposable database and then exercises real queries and transactions.

Do not run migrations against production without authorization, a verified backup, and compatibility review. Prefer forward fixes. Destructive schema rollback requires a controlled restore to a separate database, verification, and a planned cutover; see DEPLOYMENT.md. Row-level security is not enabled: isolation is enforced by API query predicates and role checks, with regression tests. Any future direct database consumer must enforce equivalent isolation or add RLS.
