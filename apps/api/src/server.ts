import { parseEnvironment } from '@sitepulse/config';
import { createDatabase } from '@sitepulse/database';
import { buildApp } from './app';

const env = parseEnvironment(process.env);
const { db, pool } = createDatabase(env.DATABASE_URL);
pool.on('error', () => {
  console.error('Database connection pool error');
});
const app = await buildApp({ db, env });
app.addHook('onClose', async () => {
  await pool.end();
});
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    void app.close();
  });
}
await app.listen({ host: '0.0.0.0', port: env.API_PORT });
