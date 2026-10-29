import { randomUUID } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import type { Environment } from '@sitepulse/config';
import { eq, schema, type Database } from '@sitepulse/database';
import { createAuthMailer, type SendAuthMail } from './auth-mail';

export function createAuth(
  db: Database,
  env: Environment,
  sendMail: SendAuthMail = createAuthMailer(env, db),
) {
  const send = async (to: string, kind: 'reset' | 'verify', token: string) => {
    const url = new URL(
      kind === 'reset' ? '/reset-password' : '/verify-email',
      env.APP_ORIGIN,
    );
    // Fragments never reach HTTP request/access logs or Referer headers.
    url.hash = new URLSearchParams({ token }).toString();
    await sendMail({ to, kind, url: url.href });
  };
  return betterAuth({
    appName: 'SitePulse',
    baseURL: env.APP_ORIGIN,
    basePath: '/api/v1/auth',
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [env.APP_ORIGIN],
    account: {
      encryptOAuthTokens: true,
      accountLinking: { enabled: true, disableImplicitLinking: true },
    },
    socialProviders:
      env.GOOGLE_DRIVE_CLIENT_ID && env.GOOGLE_DRIVE_CLIENT_SECRET
        ? {
            google: {
              clientId: env.GOOGLE_DRIVE_CLIENT_ID,
              clientSecret: env.GOOGLE_DRIVE_CLIENT_SECRET,
              accessType: 'offline',
              prompt: 'consent',
              scope: ['https://www.googleapis.com/auth/drive.file'],
              disableSignUp: true,
              disableImplicitSignUp: true,
            },
          }
        : {},
    database: drizzleAdapter(db, {
      provider: 'pg',
      transaction: true,
      schema: {
        user: schema.users,
        session: schema.sessions,
        account: schema.accounts,
        verification: schema.verifications,
      },
    }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      resetPasswordTokenExpiresIn: 30 * 60,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: ({ user, token }) => send(user.email, 'reset', token),
      password: {
        hash: (password) =>
          hash(password, {
            algorithm: 2 /* Argon2id */,
            memoryCost: 19456,
            timeCost: 2,
            parallelism: 1,
          }),
        verify: ({ hash: storedHash, password }) =>
          verify(storedHash, password),
      },
    },
    emailVerification: {
      expiresIn: 60 * 60,
      sendOnSignUp: true,
      autoSignInAfterVerification: false,
      sendVerificationEmail: ({ user, token }) =>
        send(user.email, 'verify', token),
      afterEmailVerification: async (user) => {
        await db
          .update(schema.users)
          .set({ emailVerifiedAt: new Date() })
          .where(eq(schema.users.id, user.id));
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      cookieCache: { enabled: false },
    },
    advanced: {
      useSecureCookies: env.NODE_ENV === 'production',
      database: { generateId: () => randomUUID() },
      defaultCookieAttributes: { httpOnly: true, sameSite: 'lax', path: '/' },
    },
    // Fastify enforces the external auth rate limit, including in tests.
    rateLimit: { enabled: false },
    logger: { disabled: true },
  });
}
export type Auth = ReturnType<typeof createAuth>;
