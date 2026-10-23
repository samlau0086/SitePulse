import { databaseEnvironment } from '@sitepulse/config';
import { createDatabase } from './index';
import { migrateDatabase } from './migrations';

const parsed = databaseEnvironment.safeParse(process.env);
if (!parsed.success) throw new Error('A valid DATABASE_URL is required');
const { db, pool } = createDatabase(parsed.data.DATABASE_URL);
try {
  await migrateDatabase(db);
  console.info('Database migrations completed.');
} finally {
  await pool.end();
}
