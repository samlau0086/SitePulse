import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { Database } from './index';

export async function migrateDatabase(db: Database) {
  await migrate(db, {
    migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)),
  });
}
