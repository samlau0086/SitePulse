import { z } from 'zod';

export const planSiteLimits = {
  free: 2,
  pro: 10,
  agency: 30,
  agency_plus: 100,
} as const;

const postgresUrl = z
  .string()
  .url()
  .refine(
    (value) =>
      ['postgres:', 'postgresql:'].includes(URL.parse(value)?.protocol ?? ''),
    'Expected a PostgreSQL URL',
  );
export const databaseEnvironment = z.object({ DATABASE_URL: postgresUrl });
const barkEncryptionKey = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z
    .string()
    .regex(/^[a-fA-F0-9]{64}$/)
    .optional(),
);
export const workerEnvironment = databaseEnvironment.extend({
  NOTIFICATION_ENCRYPTION_KEY: barkEncryptionKey,
  BARK_ENCRYPTION_KEY: barkEncryptionKey,
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  APP_ORIGIN: z
    .string()
    .url()
    .default('http://localhost:3000')
    .refine((value) => URL.parse(value)?.origin === value),
  AUTH_MAIL_TRANSPORT: z.enum(['file', 'resend']).default('file'),
  AUTH_MAIL_FROM: z.email().default('no-reply@localhost.test'),
  RESEND_API_KEY: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().min(16).optional(),
  ),
  HEARTBEAT_STALE_SECONDS: z.coerce
    .number()
    .int()
    .min(1800)
    .max(86400)
    .default(2700),
  WORKER_POLL_SECONDS: z.coerce.number().int().min(10).max(300).default(60),
  MONITORING_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  SECURITY_ADVISORIES_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  MONITOR_INTERVAL_SECONDS: z.coerce
    .number()
    .int()
    .min(60)
    .max(3600)
    .default(300),
  SSL_INTERVAL_SECONDS: z.coerce
    .number()
    .int()
    .min(3600)
    .max(604800)
    .default(86400),
});
export function parseWorkerEnvironment(
  input: Record<string, string | undefined>,
) {
  const result = workerEnvironment.safeParse(input);
  if (!result.success) throw new Error('Invalid worker environment variables');
  if (
    result.data.AUTH_MAIL_TRANSPORT === 'resend' &&
    !result.data.RESEND_API_KEY
  )
    throw new Error(
      'RESEND_API_KEY is required for AUTH_MAIL_TRANSPORT=resend',
    );
  if (
    result.data.NODE_ENV === 'production' &&
    result.data.AUTH_MAIL_TRANSPORT !== 'resend'
  )
    throw new Error('AUTH_MAIL_TRANSPORT must be resend in production');
  if (
    result.data.NODE_ENV === 'production' &&
    !result.data.APP_ORIGIN.startsWith('https://')
  )
    throw new Error('APP_ORIGIN must use HTTPS in production');
  return result.data;
}
const schema = databaseEnvironment.extend({
  NOTIFICATION_ENCRYPTION_KEY: barkEncryptionKey,
  BARK_ENCRYPTION_KEY: barkEncryptionKey,
  PLATFORM_ADMIN_USER_IDS: z
    .string()
    .default('')
    .transform((value) =>
      value.trim() === ''
        ? []
        : value.split(',').map((id) => id.trim().toLowerCase()),
    )
    .pipe(z.array(z.uuid())),
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  APP_ORIGIN: z
    .string()
    .url()
    .refine((value) => {
      const url = URL.parse(value);
      return (
        !!url &&
        ['http:', 'https:'].includes(url.protocol) &&
        url.origin === value
      );
    }, 'Expected an HTTP(S) origin without a path or trailing slash'),
  BETTER_AUTH_SECRET: z
    .string()
    .min(32)
    .refine(
      (value) =>
        !/change.?me|replace|example|your.?secret|placeholder/i.test(value),
      'Generate a random authentication secret',
    ),
  AUTH_MAIL_TRANSPORT: z.enum(['file', 'resend']).default('file'),
  AUTH_MAIL_FROM: z.email().default('no-reply@localhost.test'),
  RESEND_API_KEY: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().min(16).optional(),
  ),
  LOG_LEVEL: z
    .enum(['silent', 'error', 'warn', 'info', 'debug'])
    .default('info'),
});

export function parseEnvironment(input: Record<string, string | undefined>) {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new Error(
      `Invalid environment variables: ${result.error.issues.map((issue) => issue.path.join('.')).join(', ')}`,
    );
  }
  if (
    result.data.NODE_ENV === 'production' &&
    !result.data.APP_ORIGIN.startsWith('https://')
  ) {
    throw new Error('APP_ORIGIN must use HTTPS in production');
  }
  if (
    result.data.AUTH_MAIL_TRANSPORT === 'resend' &&
    !result.data.RESEND_API_KEY
  )
    throw new Error(
      'RESEND_API_KEY is required for AUTH_MAIL_TRANSPORT=resend',
    );
  if (
    result.data.NODE_ENV === 'production' &&
    result.data.AUTH_MAIL_TRANSPORT !== 'resend'
  )
    throw new Error('AUTH_MAIL_TRANSPORT must be resend in production');
  return result.data;
}
export type Environment = ReturnType<typeof parseEnvironment>;

export function parseWebEnvironment(input: Record<string, string | undefined>) {
  const result = z
    .object({
      API_INTERNAL_ORIGIN: z
        .string()
        .url()
        .default('http://127.0.0.1:4000')
        .refine((value) => {
          const url = URL.parse(value);
          return (
            !!url &&
            ['http:', 'https:'].includes(url.protocol) &&
            value === url.origin
          );
        }),
    })
    .safeParse(input);
  if (!result.success)
    throw new Error('Invalid environment variable: API_INTERNAL_ORIGIN');
  return result.data;
}
