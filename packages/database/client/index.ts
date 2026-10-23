import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from '../schema/index';

export function createDatabase(connectionString: string) {
  const pool = new pg.Pool({
    connectionString,
    max: 10,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
  });
  return { db: drizzle(pool, { schema }), pool };
}
export type Database = ReturnType<typeof createDatabase>['db'];
export { schema };
export { and, eq, sql, desc } from 'drizzle-orm';
