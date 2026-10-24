import { z } from 'zod';
import { parseEnvironment, parseWorkerEnvironment } from './index';

// Single-quoted Compose dotenv values are literal, including dollar signs.
const literal = z
  .string()
  .min(1)
  .refine((value) =>
    [...value].every(
      (character) =>
        character.charCodeAt(0) >= 32 &&
        character.charCodeAt(0) !== 127 &&
        character !== "'" &&
        character !== '\\',
    ),
  );
const deploymentSchema = z.object({
  APP_ORIGIN: z.string().regex(/^https:\/\/[a-zA-Z0-9][a-zA-Z0-9.-]*$/),
  POSTGRES_USER: z
    .string()
    .regex(/^[a-z_][a-z0-9_]{0,62}$/)
    .default('sitepulse'),
  POSTGRES_DB: z
    .string()
    .regex(/^[a-z_][a-z0-9_]{0,62}$/)
    .default('sitepulse'),
  POSTGRES_PASSWORD: z
    .string()
    .min(32)
    .regex(/^[a-zA-Z0-9_-]+$/),
  BETTER_AUTH_SECRET: literal,
  AUTH_MAIL_FROM: z.email().and(literal),
  RESEND_API_KEY: literal.min(16),
  BACKUP_AGE_RECIPIENT: z.string().regex(/^age1[0-9a-z]{58}$/),
});

export function prepareDeploymentConfiguration(
  input: Record<string, string | undefined>,
) {
  const result = deploymentSchema.safeParse(input);
  if (!result.success) {
    throw new Error(
      `Invalid deployment variables: ${result.error.issues.map((issue) => issue.path.join('.')).join(', ')}`,
    );
  }
  const data = result.data;
  const databaseUrl = `postgresql://${data.POSTGRES_USER}:${data.POSTGRES_PASSWORD}@sitepulse-db:5432/${data.POSTGRES_DB}`;
  const api = parseEnvironment({
    ...data,
    DATABASE_URL: databaseUrl,
    NODE_ENV: 'production',
    AUTH_MAIL_TRANSPORT: 'resend',
    LOG_LEVEL: input.LOG_LEVEL,
  });
  const worker = parseWorkerEnvironment({
    ...input,
    DATABASE_URL: databaseUrl,
  });
  const values = {
    NODE_ENV: 'production',
    APP_ORIGIN: api.APP_ORIGIN,
    POSTGRES_USER: data.POSTGRES_USER,
    POSTGRES_DB: data.POSTGRES_DB,
    POSTGRES_PASSWORD: data.POSTGRES_PASSWORD,
    BETTER_AUTH_SECRET: api.BETTER_AUTH_SECRET,
    AUTH_MAIL_TRANSPORT: api.AUTH_MAIL_TRANSPORT,
    AUTH_MAIL_FROM: api.AUTH_MAIL_FROM,
    RESEND_API_KEY: api.RESEND_API_KEY!,
    LOG_LEVEL: api.LOG_LEVEL,
    HEARTBEAT_STALE_SECONDS: String(worker.HEARTBEAT_STALE_SECONDS),
    WORKER_POLL_SECONDS: String(worker.WORKER_POLL_SECONDS),
  };
  return {
    '.env': Object.entries(values)
      .map(([key, value]) => `${key}='${value}'\n`)
      .join(''),
    'public-origin.txt': `${api.APP_ORIGIN}\n`,
    'backup-recipient.txt': `${data.BACKUP_AGE_RECIPIENT}\n`,
  };
}
