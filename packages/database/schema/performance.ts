import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
  check,
} from 'drizzle-orm/pg-core';
import { sites } from './index';

// Runtime payloads are validated by packages/api-contracts before persistence.
type Report = {
  score: number;
  analyzedAt: string;
  lighthouseVersion: string;
  metrics: {
    fcpMs: number | null;
    lcpMs: number | null;
    speedIndexMs: number | null;
    tbtMs: number | null;
    cls: number | null;
  };
  opportunities: Array<{ id: string; title: string; savingsMs: number }>;
};
export const performanceJobs = pgTable(
  'performance_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    siteId: uuid('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    strategy: text('strategy', { enum: ['mobile', 'desktop'] }).notNull(),
    nextRunAt: timestamp('next_run_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    requestedAt: timestamp('requested_at', { withTimezone: true }),
    lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }),
    leaseToken: uuid('lease_token'),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
    errorCode: text('error_code'),
    report: jsonb('report').$type<Report>(),
  },
  (t) => [
    uniqueIndex('performance_jobs_site_strategy_unique').on(
      t.siteId,
      t.strategy,
    ),
    index('performance_jobs_due_idx').on(t.nextRunAt),
    check(
      'performance_jobs_strategy_valid',
      sql`${t.strategy} in ('mobile', 'desktop')`,
    ),
  ],
);
export const performanceChecks = pgTable(
  'performance_checks',
  {
    // Same ID as the lease; a claimed attempt consumes budget even after a worker crash.
    id: uuid('id').primaryKey(),
    siteId: uuid('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    strategy: text('strategy', { enum: ['mobile', 'desktop'] }).notNull(),
    checkedAt: timestamp('checked_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    errorCode: text('error_code'),
    report: jsonb('report').$type<Report>(),
  },
  (t) => [
    index('performance_checks_site_time_idx').on(t.siteId, t.checkedAt),
    index('performance_checks_time_idx').on(t.checkedAt),
    check(
      'performance_checks_strategy_valid',
      sql`${t.strategy} in ('mobile', 'desktop')`,
    ),
  ],
);
