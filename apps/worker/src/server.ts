import { parseWorkerEnvironment } from '@sitepulse/config';
import { createDatabase } from '@sitepulse/database';
import { expireHeartbeats } from './heartbeat';
import { runMonitoring } from './monitoring';
import { deliverNotificationBatch } from './notifications';
import { runSecurityAssessment } from './security';
import { runPerformance } from './performance';

const env = parseWorkerEnvironment(process.env);
const { db, pool } = createDatabase(env.DATABASE_URL);
pool.on('error', () => console.error('Worker database connection error'));
let stopped = false;
let wake: (() => void) | undefined;
let securityTask: Promise<unknown> | undefined;
let performanceTask: Promise<unknown> | undefined;
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
  if (env.MONITORING_ENABLED && !stopped) {
    try {
      await runMonitoring(db, env);
    } catch {
      console.error('Monitoring sweep failed');
    }
  }
  if (env.SECURITY_ADVISORIES_ENABLED && !stopped && !securityTask) {
    securityTask = runSecurityAssessment(db)
      .catch(() => {
        console.error('Security assessment sweep failed');
      })
      .finally(() => {
        securityTask = undefined;
      });
  }
  if (!stopped) {
    if (env.PERFORMANCE_ENABLED && !performanceTask) {
      performanceTask = runPerformance(db, env)
        .catch(() => {
          console.error('Performance sweep failed');
        })
        .finally(() => {
          performanceTask = undefined;
        });
    }
    try {
      await deliverNotificationBatch(db, env);
    } catch {
      console.error('Notification delivery sweep failed');
    }
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
await securityTask;
await performanceTask;
await pool.end();
