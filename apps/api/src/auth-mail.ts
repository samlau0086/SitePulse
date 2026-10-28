import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import type { Environment } from '@sitepulse/config';
import type { Database } from '@sitepulse/database';
import { workspaceEmailBrand } from '@sitepulse/database/branding';
import { emailHtml } from '@sitepulse/shared/email';

export type AuthMail = {
  to: string;
  kind: 'reset' | 'verify' | 'notification-verify' | 'notification-test';
  url: string;
  organizationId?: string;
};
export type SendAuthMail = (mail: AuthMail) => Promise<void>;

export function createAuthMailer(env: Environment, db: Database): SendAuthMail {
  return async (mail) => {
    const notification = mail.kind.startsWith('notification-');
    const brand = await workspaceEmailBrand(
      db,
      notification ? mail.organizationId : undefined,
    );
    const baseSubject =
      mail.kind === 'notification-test'
        ? 'SitePulse notification test'
        : mail.kind === 'notification-verify'
          ? 'Verify your SitePulse alert recipient'
          : mail.kind === 'reset'
            ? 'Reset your SitePulse password'
            : 'Verify your SitePulse email';
    const subject = baseSubject.replace('SitePulse', brand.name);
    const text =
      mail.kind === 'notification-test'
        ? `${subject}\n\nYour verified alert recipient is configured. This is a test, not an incident.\n${mail.url}`
        : `${subject}\n\nOpen this link, then confirm on the page:\n${mail.url}\n\nThis link expires in ${mail.kind === 'reset' ? '30 minutes' : '1 hour'}. If you did not request it, ignore this message.`;
    const html = emailHtml({
      brand,
      title: subject,
      text: text.replace(`${subject}\n\n`, '').replace(mail.url, ''),
      actionUrl: mail.url,
      actionLabel:
        mail.kind === 'reset'
          ? 'Reset password'
          : mail.kind === 'notification-test'
            ? 'Open dashboard'
            : 'Review and confirm',
    });
    if (env.AUTH_MAIL_TRANSPORT === 'file') {
      // Never print links/tokens. The development outbox is ignored by Git and Docker.
      const directory = resolve(import.meta.dirname, '../../../.local/mail');
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await writeFile(
        resolve(directory, `${randomUUID()}.json`),
        JSON.stringify({ to: mail.to, subject, text, html }),
        { mode: 0o600, flag: 'wx' },
      );
      return;
    }
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: env.AUTH_MAIL_FROM,
        to: [mail.to],
        subject,
        text,
        html,
      }),
    });
    // Provider responses can contain customer details. Never propagate them.
    await response.body?.cancel();
    if (!response.ok) throw new Error('AUTH_MAIL_DELIVERY_FAILED');
  };
}
