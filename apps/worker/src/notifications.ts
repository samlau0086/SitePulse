import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { and, eq, schema, sql, type Database } from '@sitepulse/database';
import { workspaceEmailBrand } from '@sitepulse/database/branding';
import {
  emailHtml,
  defaultEmailBrand,
  type EmailBrand,
} from '@sitepulse/shared/email';
import {
  decryptBarkKey,
  sendBark,
  type SendBark,
} from '@sitepulse/shared/bark';
import {
  decryptChatSecret,
  sendChat,
  type SendChat,
} from '@sitepulse/shared/chat-notifications';

type MailOptions = {
  NOTIFICATION_ENCRYPTION_KEY?: string | undefined;
  BARK_ENCRYPTION_KEY?: string | undefined;
  AUTH_MAIL_TRANSPORT: 'file' | 'resend';
  AUTH_MAIL_FROM: string;
  RESEND_API_KEY?: string;
  APP_ORIGIN: string;
};
type Delivery = typeof schema.notificationDeliveries.$inferSelect;

export async function recipientStillEnabled(db: Database, delivery: Delivery) {
  // Pre-migration orphan history has no live organization and must not be delivered.
  if (!delivery.organizationId) return false;
  if (delivery.endpointId) {
    const [endpoint] = await db
      .select()
      .from(schema.notificationEndpoints)
      .where(
        and(
          eq(schema.notificationEndpoints.id, delivery.endpointId),
          eq(
            schema.notificationEndpoints.organizationId,
            delivery.organizationId,
          ),
        ),
      );
    return (
      !!endpoint &&
      endpoint.enabled &&
      !!endpoint.verifiedAt &&
      !endpoint.deletedAt &&
      endpoint.destination === delivery.recipient &&
      endpoint.type === delivery.channel
    );
  }
  if (delivery.channel !== 'email') return false;
  const [settings] = await db
    .select()
    .from(schema.notificationSettings)
    .where(
      eq(schema.notificationSettings.organizationId, delivery.organizationId),
    );
  if (settings?.includeMembers === false) return false;
  const overrides = await db
    .select({ id: schema.notificationEndpoints.id })
    .from(schema.notificationEndpoints)
    .where(
      and(
        eq(
          schema.notificationEndpoints.organizationId,
          delivery.organizationId,
        ),
        eq(schema.notificationEndpoints.destination, delivery.recipient),
      ),
    );
  if (overrides.length) return false;
  const members = await db
    .select({ id: schema.users.id })
    .from(schema.organizationMembers)
    .innerJoin(
      schema.users,
      eq(schema.users.id, schema.organizationMembers.userId),
    )
    .where(
      and(
        eq(schema.organizationMembers.organizationId, delivery.organizationId),
        eq(schema.users.email, delivery.recipient),
        eq(schema.users.emailVerified, true),
      ),
    );
  return members.length > 0;
}

export async function claimNotificationDeliveries(
  db: Database,
  channel?: Delivery['channel'],
) {
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
          channel
            ? eq(schema.notificationDeliveries.channel, channel)
            : undefined,
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

export function incidentMail(
  delivery: Pick<
    Delivery,
    'eventType' | 'monitorType' | 'siteName' | 'siteUrl' | 'severity'
  >,
  origin: string,
  brand: EmailBrand = defaultEmailBrand,
) {
  const recovered = delivery.eventType === 'recovered';
  const connector = delivery.monitorType === 'stale_data';
  const subject = `${connector ? (recovered ? 'Connector restored' : 'Connector offline') : recovered ? 'Recovered' : 'Incident'}: ${delivery.siteName} (${delivery.monitorType})`;
  const text = [
    subject,
    '',
    connector
      ? recovered
        ? `A valid connector heartbeat was received from ${delivery.siteName}. This does not confirm HTTP availability.`
        : `Connector heartbeats are overdue for ${delivery.siteName}. Website availability is monitored independently; this is not an HTTP downtime alert.`
      : recovered
        ? `Monitoring confirmed that ${delivery.siteName} has recovered.`
        : `Monitoring confirmed a ${delivery.severity} ${delivery.monitorType} incident for ${delivery.siteName}.`,
    `Site: ${delivery.siteUrl}`,
    `Incident history: ${origin}/app/incidents`,
    '',
    'This alert was sent to a verified recipient of the site workspace.',
  ].join('\n');
  const html = emailHtml({
    brand,
    title: subject,
    text: text
      .split('\n')
      .slice(2)
      .filter((line) => !line.startsWith('Incident history:'))
      .join('\n'),
    actionUrl: `${origin}/app/incidents`,
    actionLabel: 'View incident history',
    status: recovered ? 'success' : 'attention',
  });
  return { subject, text, html };
}

async function sendMail(
  db: Database,
  delivery: Delivery,
  options: MailOptions,
) {
  const brand = await workspaceEmailBrand(db, delivery.organizationId);
  const { subject, text, html } = incidentMail(
    delivery,
    options.APP_ORIGIN,
    brand,
  );

  if (options.AUTH_MAIL_TRANSPORT === 'file') {
    const directory = resolve(process.cwd(), '.local/alert-mail');
    await mkdir(directory, { recursive: true, mode: 0o700 });
    try {
      await writeFile(
        resolve(directory, `${delivery.id}.json`),
        JSON.stringify({ to: delivery.recipient, subject, text, html }),
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
      html,
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
  barkSender: SendBark = sendBark,
  chatSender: SendChat = sendChat,
) {
  // Separate bounded batches prevent an email backlog from starving push alerts.
  const deliveries = (
    await Promise.all([
      claimNotificationDeliveries(db, 'email'),
      claimNotificationDeliveries(db, 'bark'),
      claimNotificationDeliveries(db, 'slack'),
      claimNotificationDeliveries(db, 'telegram'),
    ])
  ).flat();
  await Promise.all(
    deliveries.map(async (delivery) => {
      try {
        if (!(await recipientStillEnabled(db, delivery))) {
          await db
            .update(schema.notificationDeliveries)
            .set({
              status: 'failed',
              lastErrorCode: 'RECIPIENT_DISABLED',
              leaseToken: null,
              leaseExpiresAt: null,
            })
            .where(
              and(
                eq(schema.notificationDeliveries.id, delivery.id),
                eq(
                  schema.notificationDeliveries.leaseToken,
                  delivery.leaseToken!,
                ),
              ),
            );
          return;
        }
        let providerMessageId: string;
        if (delivery.channel === 'bark') {
          if (!options.BARK_ENCRYPTION_KEY)
            throw new Error('BARK_NOT_CONFIGURED');
          const [endpoint] = await db
            .select()
            .from(schema.notificationEndpoints)
            .where(
              and(
                eq(schema.notificationEndpoints.id, delivery.endpointId!),
                eq(
                  schema.notificationEndpoints.organizationId,
                  delivery.organizationId!,
                ),
                eq(
                  schema.notificationEndpoints.destination,
                  delivery.recipient,
                ),
                eq(schema.notificationEndpoints.type, 'bark'),
                eq(schema.notificationEndpoints.enabled, true),
                sql`${schema.notificationEndpoints.verifiedAt} is not null`,
                sql`${schema.notificationEndpoints.deletedAt} is null`,
              ),
            );
          if (!endpoint?.encryptedKey) throw new Error('BARK_KEY_UNAVAILABLE');
          let deviceKey: string;
          try {
            deviceKey = decryptBarkKey(
              endpoint.encryptedKey,
              options.BARK_ENCRYPTION_KEY,
              delivery.organizationId!,
            );
          } catch {
            throw new Error('BARK_KEY_UNAVAILABLE');
          }
          const { subject, text } = incidentMail(delivery, options.APP_ORIGIN);
          await barkSender({
            deviceKey,
            title: subject,
            body: text,
            url: `${options.APP_ORIGIN}/app/incidents`,
          });
          providerMessageId = `bark:${delivery.id}`;
        } else if (
          delivery.channel === 'slack' ||
          delivery.channel === 'telegram'
        ) {
          if (!options.NOTIFICATION_ENCRYPTION_KEY)
            throw new Error('CHANNEL_NOT_CONFIGURED');
          const [endpoint] = await db
            .select()
            .from(schema.notificationEndpoints)
            .where(
              and(
                eq(schema.notificationEndpoints.id, delivery.endpointId!),
                eq(
                  schema.notificationEndpoints.organizationId,
                  delivery.organizationId!,
                ),
                eq(schema.notificationEndpoints.type, delivery.channel),
                eq(
                  schema.notificationEndpoints.destination,
                  delivery.recipient,
                ),
                eq(schema.notificationEndpoints.enabled, true),
                sql`${schema.notificationEndpoints.verifiedAt} is not null`,
                sql`${schema.notificationEndpoints.deletedAt} is null`,
              ),
            );
          if (!endpoint?.encryptedKey)
            throw new Error('CHANNEL_KEY_UNAVAILABLE');
          let secret: string;
          try {
            secret = decryptChatSecret(
              endpoint.encryptedKey,
              options.NOTIFICATION_ENCRYPTION_KEY,
              delivery.organizationId!,
              delivery.channel,
            );
          } catch {
            throw new Error('CHANNEL_KEY_UNAVAILABLE');
          }
          const { subject, text } = incidentMail(delivery, options.APP_ORIGIN);
          await chatSender({
            channel: delivery.channel,
            secret,
            title: subject,
            body: text,
            url: `${options.APP_ORIGIN}/app/incidents`,
          });
          providerMessageId = `${delivery.channel}:${delivery.id}`;
        } else providerMessageId = await sendMail(db, delivery, options);
        await finishDelivery(db, delivery, { providerMessageId });
      } catch (error) {
        const errorCode =
          error instanceof Error &&
          [
            'PROVIDER_REJECTED',
            'PROVIDER_INVALID_RESPONSE',
            'BARK_NOT_CONFIGURED',
            'BARK_KEY_UNAVAILABLE',
            'CHANNEL_NOT_CONFIGURED',
            'CHANNEL_KEY_UNAVAILABLE',
            'PROVIDER_INVALID_CREDENTIAL',
          ].includes(error.message)
            ? error.message
            : 'PROVIDER_UNAVAILABLE';
        await finishDelivery(db, delivery, { errorCode });
      }
    }),
  );
  return deliveries.length;
}
