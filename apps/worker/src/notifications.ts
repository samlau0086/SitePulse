import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { and, eq, schema, sql, type Database } from '@sitepulse/database';

type MailOptions = {
  AUTH_MAIL_TRANSPORT: 'file' | 'resend';
  AUTH_MAIL_FROM: string;
  RESEND_API_KEY?: string;
  APP_ORIGIN: string;
};
type Delivery = typeof schema.notificationDeliveries.$inferSelect;

export async function claimNotificationDeliveries(db: Database) {
  return db.transaction(async (tx) => {
    await tx
      .update(schema.notificationDeliveries)
      .set({ status: 'failed', lastErrorCode: 'RETRY_LIMIT' })
      .where(
        and(
          eq(schema.notificationDeliveries.status, 'sending'),
          sql`${schema.notificationDeliveries.leaseExpiresAt} <= now()`,
          sql`${schema.notificationDeliveries.attempts} >= 8`,
        ),
      );
    const rows = await tx
      .select()
      .from(schema.notificationDeliveries)
      .where(
        and(
          sql`(${schema.notificationDeliveries.status} = 'queued' and ${schema.notificationDeliveries.nextAttemptAt} <= now()) or (${schema.notificationDeliveries.status} = 'sending' and ${schema.notificationDeliveries.leaseExpiresAt} <= now())`,
          sql`${schema.notificationDeliveries.attempts} < 8`,
        ),
      )
      .orderBy(schema.notificationDeliveries.nextAttemptAt)
      .limit(5)
      .for('update', { skipLocked: true });
    const claimed: Delivery[] = [];
    for (const row of rows) {
      const [updated] = await tx
        .update(schema.notificationDeliveries)
        .set({
          status: 'sending',
          attempts: row.attempts + 1,
          leaseToken: randomUUID(),
          leaseExpiresAt: sql`now() + interval '60 seconds'`,
        })
        .where(eq(schema.notificationDeliveries.id, row.id))
        .returning();
      if (updated) claimed.push(updated);
    }
    return claimed;
  });
}

async function sendMail(delivery: Delivery, options: MailOptions) {
  const recovered = delivery.eventType === 'recovered';
  const subject = `${recovered ? 'Recovered' : 'Incident'}: ${delivery.siteName} (${delivery.monitorType})`;
  const text = [
    subject,
    '',
    recovered
      ? `Monitoring confirmed that ${delivery.siteName} has recovered.`
      : `Monitoring confirmed a ${delivery.severity} ${delivery.monitorType} incident for ${delivery.siteName}.`,
    `Site: ${delivery.siteUrl}`,
    `Incident history: ${options.APP_ORIGIN}/app/incidents`,
    '',
    'This alert was sent to a verified member of the site organization.',
  ].join('\n');

  if (options.AUTH_MAIL_TRANSPORT === 'file') {
    const directory = resolve(process.cwd(), '.local/alert-mail');
    await mkdir(directory, { recursive: true, mode: 0o700 });
    try {
      await writeFile(
        resolve(directory, `${delivery.id}.json`),
        JSON.stringify({ to: delivery.recipient, subject, text }),
        { mode: 0o600, flag: 'wx' },
      );
    } catch (error) {
      if (
        !error ||
        typeof error !== 'object' ||
        !('code' in error) ||
        error.code !== 'EEXIST'
      )
        throw error;
    }
    return `file:${delivery.id}`;
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(10000),
    headers: {
      Authorization: `Bearer ${options.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': delivery.eventKey,
    },
    body: JSON.stringify({
      from: options.AUTH_MAIL_FROM,
      to: [delivery.recipient],
      subject,
      text,
    }),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error('PROVIDER_REJECTED');
  }
  const payload: unknown = await response.json().catch(() => null);
  if (
    !payload ||
    typeof payload !== 'object' ||
    !('id' in payload) ||
    typeof payload.id !== 'string'
  )
    throw new Error('PROVIDER_INVALID_RESPONSE');
  return payload.id;
}

async function finishDelivery(
  db: Database,
  delivery: Delivery,
  result: { providerMessageId: string } | { errorCode: string },
) {
  if ('providerMessageId' in result) {
    await db
      .update(schema.notificationDeliveries)
      .set({
        status: 'sent',
        providerMessageId: result.providerMessageId,
        sentAt: sql`now()`,
        leaseExpiresAt: null,
        lastErrorCode: null,
      })
      .where(
        and(
          eq(schema.notificationDeliveries.id, delivery.id),
          eq(schema.notificationDeliveries.status, 'sending'),
          eq(schema.notificationDeliveries.leaseToken, delivery.leaseToken!),
        ),
      );
    return;
  }
  const permanent = delivery.attempts >= 8;
  const retrySeconds = Math.min(3600, 30 * 2 ** (delivery.attempts - 1));
  await db
    .update(schema.notificationDeliveries)
    .set({
      status: permanent ? 'failed' : 'queued',
      nextAttemptAt: sql`now() + make_interval(secs => ${retrySeconds}::int)`,
      leaseToken: null,
      leaseExpiresAt: null,
      lastErrorCode: result.errorCode,
    })
    .where(
      and(
        eq(schema.notificationDeliveries.id, delivery.id),
        eq(schema.notificationDeliveries.status, 'sending'),
        eq(schema.notificationDeliveries.leaseToken, delivery.leaseToken!),
      ),
    );
}

export async function deliverNotificationBatch(
  db: Database,
  options: MailOptions,
) {
  const deliveries = await claimNotificationDeliveries(db);
  await Promise.all(
    deliveries.map(async (delivery) => {
      try {
        const providerMessageId = await sendMail(delivery, options);
        await finishDelivery(db, delivery, { providerMessageId });
      } catch (error) {
        const errorCode =
          error instanceof Error &&
          ['PROVIDER_REJECTED', 'PROVIDER_INVALID_RESPONSE'].includes(
            error.message,
          )
            ? error.message
            : 'PROVIDER_UNAVAILABLE';
        await finishDelivery(db, delivery, { errorCode });
      }
    }),
  );
  return deliveries.length;
}
