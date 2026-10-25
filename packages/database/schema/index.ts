import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const createdAt = () =>
  timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull().unique(),
    name: text('name').notNull(),
    emailVerified: boolean('email_verified').notNull().default(false),
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    image: text('image'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    check(
      'users_email_normalized',
      sql`${table.email} = lower(trim(${table.email}))`,
    ),
  ],
);

// Better Auth owns these three tables. Password hashes live on credential accounts.
export const accounts = pgTable(
  'auth_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    password: text('password_hash'),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', {
      withTimezone: true,
    }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', {
      withTimezone: true,
    }),
    scope: text('scope'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('auth_accounts_provider_account_unique').on(
      table.providerId,
      table.accountId,
    ),
    index('auth_accounts_user_idx').on(table.userId),
  ],
);

export const sessions = pgTable(
  'auth_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    token: text('token').notNull().unique(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index('auth_sessions_user_idx').on(table.userId),
    index('auth_sessions_expiry_idx').on(table.expiresAt),
  ],
);

export const verifications = pgTable(
  'auth_verifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index('auth_verifications_identifier_idx').on(table.identifier)],
);

export const organizations = pgTable(
  'organizations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    slug: text('slug').notNull().unique(),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    planCode: text('plan_code').notNull().default('free'),
    siteLimitOverride: integer('site_limit_override'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    check(
      'organizations_plan_valid',
      sql`${table.planCode} in ('free', 'pro', 'agency', 'agency_plus')`,
    ),
    check(
      'organizations_site_limit_valid',
      sql`${table.siteLimitOverride} between 0 and 1000`,
    ),
    check(
      'organizations_slug_valid',
      sql`${table.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(${table.slug}) BETWEEN 3 AND 63`,
    ),
  ],
);

export const organizationMembers = pgTable(
  'organization_members',
  {
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role', { enum: ['owner', 'admin', 'member'] }).notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    primaryKey({ columns: [table.organizationId, table.userId] }),
    index('organization_members_user_idx').on(table.userId),
    uniqueIndex('organization_single_owner_idx')
      .on(table.organizationId)
      .where(sql`${table.role} = 'owner'`),
    check(
      'organization_members_role_valid',
      sql`${table.role} in ('owner', 'admin', 'member')`,
    ),
  ],
);

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id').references(() => organizations.id, {
      onDelete: 'restrict',
    }),
    actorUserId: uuid('actor_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    action: text('action').notNull(),
    requestId: text('request_id').notNull(),
    createdAt: createdAt(),
    // Only explicit, non-sensitive fields belong here. Never spread request bodies.
    metadata: jsonb('metadata')
      .$type<Record<string, string>>()
      .notNull()
      .default({}),
  },
  (table) => [
    index('audit_logs_org_created_idx').on(
      table.organizationId,
      table.createdAt,
    ),
    index('audit_logs_actor_idx').on(table.actorUserId),
  ],
);

export const sites = pgTable(
  'sites',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    canonicalUrl: text('canonical_url').notNull(),
    hostname: text('hostname').notNull(),
    status: text('status', {
      enum: ['pending', 'active', 'degraded', 'disconnected'],
    })
      .notNull()
      .default('pending'),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
    connectorVersion: text('connector_version'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    index('sites_org_idx').on(table.organizationId),
    uniqueIndex('sites_org_url_unique')
      .on(table.organizationId, table.canonicalUrl)
      .where(sql`${table.deletedAt} is null`),
    check(
      'sites_status_valid',
      sql`${table.status} in ('pending', 'active', 'degraded', 'disconnected')`,
    ),
  ],
);

export const siteCredentials = pgTable(
  'site_credentials',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    siteId: uuid('site_id')
      .notNull()
      .unique()
      .references(() => sites.id, { onDelete: 'cascade' }),
    credentialHash: text('credential_hash').notNull().unique(),
    secretVersion: integer('secret_version').notNull().default(1),
    lastSequence: integer('last_sequence').notNull().default(0),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [
    check('site_credential_sequence_valid', sql`${table.lastSequence} >= 0`),
  ],
);

export const pairingChallenges = pgTable(
  'pairing_challenges',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    siteId: uuid('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    challengeHash: text('challenge_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [index('pairing_site_idx').on(table.siteId)],
);

export const siteInventorySnapshots = pgTable('site_inventory_snapshots', {
  siteId: uuid('site_id')
    .primaryKey()
    .references(() => sites.id, { onDelete: 'cascade' }),
  wordpressVersion: text('wordpress_version').notNull(),
  phpVersion: text('php_version').notNull(),
  activePlugins: jsonb('active_plugins')
    .$type<Array<{ identifier: string; name: string; version: string }>>()
    .notNull(),
  activeThemes: jsonb('active_themes')
    .$type<Array<{ identifier: string; name: string; version: string }>>()
    .notNull(),
  updateCounts: jsonb('update_counts')
    .$type<{ plugins: number; themes: number; core: number }>()
    .notNull(),
  receivedAt: timestamp('received_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: updatedAt(),
});

export const monitorJobs = pgTable(
  'monitor_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    siteId: uuid('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    monitorType: text('monitor_type', { enum: ['uptime', 'ssl'] }).notNull(),
    nextRunAt: timestamp('next_run_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    leaseToken: uuid('lease_token'),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
    failures: integer('failures').notNull().default(0),
    successes: integer('successes').notNull().default(0),
    state: text('state', {
      enum: [
        'pending',
        'healthy',
        'suspected',
        'down',
        'recovering',
        'warning',
      ],
    })
      .notNull()
      .default('pending'),
    lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('monitor_jobs_site_type_unique').on(
      table.siteId,
      table.monitorType,
    ),
    index('monitor_jobs_due_idx').on(table.nextRunAt),
    check(
      'monitor_jobs_type_valid',
      sql`${table.monitorType} in ('uptime', 'ssl')`,
    ),
    check(
      'monitor_jobs_state_valid',
      sql`${table.state} in ('pending', 'healthy', 'suspected', 'down', 'recovering', 'warning')`,
    ),
    check(
      'monitor_jobs_counters_valid',
      sql`${table.failures} >= 0 and ${table.successes} >= 0`,
    ),
  ],
);

export const monitorChecks = pgTable(
  'monitor_checks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    siteId: uuid('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    monitorType: text('monitor_type', { enum: ['uptime', 'ssl'] }).notNull(),
    checkedAt: timestamp('checked_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    result: text('result', {
      enum: ['up', 'down', 'warning', 'error'],
    }).notNull(),
    httpStatus: integer('http_status'),
    latencyMs: integer('latency_ms'),
    sslExpiresAt: timestamp('ssl_expires_at', { withTimezone: true }),
    errorCode: text('error_code'),
  },
  (table) => [
    index('monitor_checks_site_time_idx').on(table.siteId, table.checkedAt),
    check(
      'monitor_checks_type_valid',
      sql`${table.monitorType} in ('uptime', 'ssl')`,
    ),
    check(
      'monitor_checks_result_valid',
      sql`${table.result} in ('up', 'down', 'warning', 'error')`,
    ),
  ],
);

export const incidents = pgTable(
  'incidents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    siteId: uuid('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    monitorType: text('monitor_type', { enum: ['uptime', 'ssl'] }).notNull(),
    status: text('status', { enum: ['open', 'acknowledged', 'resolved'] })
      .notNull()
      .default('open'),
    severity: text('severity', { enum: ['warning', 'critical'] }).notNull(),
    fingerprint: text('fingerprint').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolutionReason: text('resolution_reason', {
      enum: ['recovered', 'connection_reset'],
    }),
  },
  (table) => [
    uniqueIndex('incidents_active_fingerprint_unique')
      .on(table.fingerprint)
      .where(sql`${table.status} <> 'resolved'`),
    index('incidents_site_time_idx').on(table.siteId, table.startedAt),
    check(
      'incidents_type_valid',
      sql`${table.monitorType} in ('uptime', 'ssl')`,
    ),
    check(
      'incidents_status_valid',
      sql`${table.status} in ('open', 'acknowledged', 'resolved')`,
    ),
    check(
      'incidents_severity_valid',
      sql`${table.severity} in ('warning', 'critical')`,
    ),
  ],
);

export const notificationDeliveries = pgTable(
  'notification_deliveries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    incidentId: uuid('incident_id').references(() => incidents.id, {
      onDelete: 'set null',
    }),
    eventKey: text('event_key').notNull().unique(),
    eventType: text('event_type', { enum: ['opened', 'recovered'] }).notNull(),
    recipient: text('recipient').notNull(),
    siteName: text('site_name').notNull(),
    siteUrl: text('site_url').notNull(),
    monitorType: text('monitor_type', { enum: ['uptime', 'ssl'] }).notNull(),
    severity: text('severity', { enum: ['warning', 'critical'] }).notNull(),
    status: text('status', { enum: ['queued', 'sending', 'sent', 'failed'] })
      .notNull()
      .default('queued'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    leaseToken: uuid('lease_token'),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
    providerMessageId: text('provider_message_id'),
    lastErrorCode: text('last_error_code'),
    createdAt: createdAt(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
  },
  (table) => [
    index('notification_deliveries_due_idx').on(
      table.status,
      table.nextAttemptAt,
    ),
    check(
      'notification_deliveries_event_valid',
      sql`${table.eventType} in ('opened', 'recovered')`,
    ),
    check(
      'notification_deliveries_status_valid',
      sql`${table.status} in ('queued', 'sending', 'sent', 'failed')`,
    ),
    check(
      'notification_deliveries_attempts_valid',
      sql`${table.attempts} >= 0`,
    ),
  ],
);
