import { parseWorkerEnvironment } from '@sitepulse/config';
import { createDatabase } from '@sitepulse/database';
import { expireHeartbeats } from './heartbeat';

const env = parseWorkerEnvironment(process.env);
const { db, pool } = createDatabase(env.DATABASE_URL);
pool.on('error', () => console.error('Worker database connection error'));
let stopped = false;
let wake: (() => void) | undefined;
for (const signal of ['SIGTERM', 'SIGINT'] as const)
  process.once(signal, () => {
    stopped = true;
    wake?.();
  });
while (!stopped) {
  try {
    await expireHeartbeats(db, env.HEARTBEAT_STALE_SECONDS);
  } catch {
    console.error('Heartbeat expiration sweep failed');
  }
  if (stopped) break;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, env.WORKER_POLL_SECONDS * 1000);
    wake = () => {
      clearTimeout(timer);
      resolve();
    };
  });
}
await pool.end();
