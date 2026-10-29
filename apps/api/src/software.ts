import { randomBytes, randomUUID, createHash } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { and, desc, eq, sql, schema, type Database } from '@sitepulse/database';
import { canManageOrganization } from '@sitepulse/shared';
import {
  emptyRequest,
  organizationParams,
  softwareBatchParams,
  softwarePreview,
  softwarePoll,
  softwareResult,
  inventorySync,
  inventoryFailure,
  attachmentUploadParams,
  attachmentUploadQuery,
  attachmentParams,
  softwarePackage,
  type SoftwareCommand,
} from '@sitepulse/api-contracts';
import { HttpError } from './http-error';
import { hashCredential } from './sites';
import { scanPackage, PACKAGE_LIMIT, SCANNER_VERSION } from './package-scanner';
import type { DriveStorage } from './google-drive';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
type User = { id: string; emailVerified: boolean };
const unavailable = () =>
  new HttpError(404, 'NOT_FOUND', 'The requested resource was not found.');
const conflict = (message: string) =>
  new HttpError(409, 'SOFTWARE_CONFLICT', message);
const minutes = (value: number) => new Date(Date.now() + value * 60_000);

export async function registerSoftwareRoutes(
  app: FastifyInstance,
  {
    db,
    requireUser,
    drive,
  }: {
    db: Database;
    requireUser: (request: FastifyRequest) => Promise<User>;
    drive: DriveStorage;
  },
) {
  const json = (value: z.ZodType) => {
    const { $schema, ...result } = z.toJSONSchema(value, { io: 'input' });
    void $schema;
    return result;
  };
  const options = (params: z.ZodType, body?: z.ZodType) => ({
    schema: {
      tags: ['Software'],
      params: json(params),
      ...(body ? { body: json(body) } : {}),
    },
  });
  async function member(
    tx: Tx,
    organizationId: string,
    user: User,
    manage = false,
  ) {
    const [row] = await tx
      .select()
      .from(schema.organizationMembers)
      .where(
        and(
          eq(schema.organizationMembers.organizationId, organizationId),
          eq(schema.organizationMembers.userId, user.id),
        ),
      )
      .for('share');
    if (!row) throw unavailable();
    if (manage && (!canManageOrganization(row.role) || !user.emailVerified))
      throw new HttpError(
        403,
        'FORBIDDEN',
        'Verified workspace administrator access is required.',
      );
    return row;
  }
  async function context(tx: Tx, organizationId: string, siteId: string) {
    const [site] = await tx
      .select()
      .from(schema.sites)
      .where(
        and(
          eq(schema.sites.id, siteId),
          eq(schema.sites.organizationId, organizationId),
          sql`${schema.sites.deletedAt} is null`,
        ),
      )
      .for('update');
    if (!site) throw unavailable();
    const [credential] = await tx
      .select()
      .from(schema.siteCredentials)
      .where(eq(schema.siteCredentials.siteId, siteId))
      .for('share');
    const [capability] = await tx
      .select()
      .from(schema.siteManagement)
      .where(eq(schema.siteManagement.siteId, siteId));
    const [inventory] = await tx
      .select()
      .from(schema.siteInventorySnapshots)
      .where(eq(schema.siteInventorySnapshots.siteId, siteId));
    return { site, credential, capability, inventory };
  }
  function ready(
    value: Awaited<ReturnType<typeof context>>,
    command: SoftwareCommand,
  ) {
    const { site, credential, capability, inventory } = value;
    if (command.attachmentId && !capability?.packageSupport)
      throw conflict(
        'Update the Connector and allow uploaded packages locally in WordPress.',
      );
    if (
      site.status !== 'active' ||
      !credential ||
      credential.revokedAt ||
      !capability?.enabled ||
      capability.secretVersion !== credential.secretVersion ||
      capability.polledAt < minutes(-5)
    )
      throw conflict(
        'Enable remote management in the updated Connector and wait for a recent poll.',
      );
    if (
      !inventory ||
      inventory.receivedAt < minutes(-60) ||
      !inventory.environment?.inventoryComplete
    )
      throw conflict('A recent, complete inventory is required.');
    const items =
      command.kind === 'plugin'
        ? inventory.installedPlugins
        : inventory.installedThemes;
    if (!items)
      throw conflict('Update the Connector to report installed components.');
    const matches = items.filter((item) => item.identifier === command.slug);
    if (matches.length > 1)
      throw conflict('Ambiguous component identifier; manage it in WordPress.');
    const item = matches[0];
    if (command.slug === 'sitepulse-connector')
      throw conflict('Manage the Connector directly in WordPress.');
    if (command.action === 'install' && item)
      throw conflict('The component is already installed.');
    if (command.action !== 'install' && !item)
      throw conflict('The component is not installed.');
    if (command.action === 'uninstall' && item?.active)
      throw conflict('Deactivate the component before uninstalling.');
    if (command.action === 'update' && item?.source !== 'wordpress.org')
      throw conflict('Only WordPress.org updates are supported.');
    if (
      command.kind === 'theme' &&
      command.action === 'deactivate' &&
      !inventory.installedThemes?.some(
        (theme) => theme.identifier === command.replacement,
      )
    )
      throw conflict('The replacement theme must be installed.');
    // Ignore receipt timestamps so an unchanged inventory refresh does not invalidate a preview.
    return createHash('sha256')
      .update(
        JSON.stringify([
          credential.secretVersion,
          inventory.installedPlugins,
          inventory.installedThemes,
        ]),
      )
      .digest('hex');
  }
  const audit = (
    tx: Tx,
    organizationId: string,
    actorUserId: string | null,
    action: string,
    metadata: Record<string, unknown>,
    requestId: string,
  ) =>
    tx.insert(schema.auditLogs).values({
      organizationId,
      actorUserId,
      action,
      metadata: Object.fromEntries(
        Object.entries(metadata).map(([key, value]) => [
          key,
          typeof value === 'string' ? value : JSON.stringify(value),
        ]),
      ),
      requestId,
    });
  async function attachment(
    tx: Tx,
    organizationId: string,
    command: SoftwareCommand,
  ) {
    if (!command.attachmentId) return null;
    const [row] = await tx
      .select()
      .from(schema.softwareAttachments)
      .where(
        and(
          eq(schema.softwareAttachments.id, command.attachmentId),
          eq(schema.softwareAttachments.organizationId, organizationId),
        ),
      )
      .for('share');
    if (!row) throw unavailable();
    if (row.storage === 'google_drive') {
      const [owner] = await tx
        .select({
          id: schema.users.id,
          emailVerified: schema.users.emailVerified,
        })
        .from(schema.users)
        .where(eq(schema.users.id, row.actorUserId))
        .for('share');
      if (!owner) throw conflict('The Drive storage owner is unavailable.');
      await member(tx, organizationId, owner, true);
    }
    if (
      command.action !== 'install' ||
      row.kind !== command.kind ||
      row.slug !== command.slug ||
      row.scan.status !== 'complete' ||
      row.scan.findings.length ||
      row.scan.version !== SCANNER_VERSION
    )
      throw conflict(
        'This attachment cannot be installed. Upload a package with a current completed scan and no findings.',
      );
    return row;
  }
  app.addContentTypeParser(
    'application/zip',
    { parseAs: 'buffer', bodyLimit: PACKAGE_LIMIT },
    (_request, body, done) => done(null, body),
  );
  app.get(
    '/api/v1/organizations/:organizationId/attachments',
    options(organizationParams),
    async (request) => {
      const user = await requireUser(request);
      const { organizationId } = organizationParams.parse(request.params);
      return db.transaction(async (tx) => {
        const membership = await member(tx, organizationId, user);
        const attachments = await tx
          .select({
            id: schema.softwareAttachments.id,
            kind: schema.softwareAttachments.kind,
            slug: schema.softwareAttachments.slug,
            name: schema.softwareAttachments.name,
            version: schema.softwareAttachments.version,
            sha256: schema.softwareAttachments.sha256,
            byteSize: schema.softwareAttachments.byteSize,
            scan: schema.softwareAttachments.scan,
            createdAt: schema.softwareAttachments.createdAt,
            storage: schema.softwareAttachments.storage,
          })
          .from(schema.softwareAttachments)
          .where(eq(schema.softwareAttachments.organizationId, organizationId))
          .orderBy(desc(schema.softwareAttachments.createdAt));
        return {
          canManage:
            user.emailVerified && canManageOrganization(membership.role),
          attachments,
          usedBytes: attachments.reduce((sum, row) => sum + row.byteSize, 0),
          limitBytes: 64 * 1024 * 1024,
        };
      });
    },
  );
  app.post(
    '/api/v1/organizations/:organizationId/attachments/:kind',
    {
      ...options(attachmentUploadParams),
      schema: {
        ...options(attachmentUploadParams).schema,
        querystring: json(attachmentUploadQuery),
      },
      bodyLimit: PACKAGE_LIMIT,
      onRequest: async (request) => {
        const user = await requireUser(request);
        const input = attachmentUploadParams.parse(request.params);
        await db.transaction((tx) =>
          member(tx, input.organizationId, user, true),
        );
      },
    },
    async (request) => {
      const user = await requireUser(request);
      const input = attachmentUploadParams.parse(request.params);
      const { storage } = attachmentUploadQuery.parse(request.query);
      if (
        request.headers['content-type'] !== 'application/zip' ||
        !Buffer.isBuffer(request.body)
      )
        throw new HttpError(415, 'INVALID_PACKAGE', 'Upload a ZIP package.');
      const bytes = request.body;
      let inspected: Awaited<ReturnType<typeof scanPackage>>;
      try {
        inspected = await scanPackage(bytes, input.kind);
      } catch (error) {
        const reason =
          error instanceof Error && error.message
            ? error.message
            : 'check archive paths, limits and WordPress headers';
        throw new HttpError(
          400,
          'INVALID_PACKAGE',
          `Package rejected: ${reason}`,
        );
      }
      let uploaded: Awaited<ReturnType<DriveStorage['upload']>> | undefined;
      try {
        return await db.transaction(async (tx) => {
          await member(tx, input.organizationId, user, true);
          await tx
            .select({ id: schema.organizations.id })
            .from(schema.organizations)
            .where(eq(schema.organizations.id, input.organizationId))
            .for('update');
          const existing = await tx
            .select({
              id: schema.softwareAttachments.id,
              sha256: schema.softwareAttachments.sha256,
              byteSize: schema.softwareAttachments.byteSize,
            })
            .from(schema.softwareAttachments)
            .where(
              eq(
                schema.softwareAttachments.organizationId,
                input.organizationId,
              ),
            );
          const duplicate = existing.find(
            (row) => row.sha256 === inspected.sha256,
          );
          if (duplicate) return { id: duplicate.id, reused: true };
          if (
            existing.length >= 100 ||
            existing.reduce((sum, row) => sum + row.byteSize, 0) +
              bytes.length >
              64 * 1024 * 1024
          )
            throw conflict(
              'Attachment storage limit reached (64 MiB / 100 packages). Delete unused packages first.',
            );
          uploaded = await drive.upload(
            user.id,
            `${inspected.slug}-${inspected.version}.zip`,
            bytes,
          );
          const [row] = await tx
            .insert(schema.softwareAttachments)
            .values({
              organizationId: input.organizationId,
              actorUserId: user.id,
              kind: input.kind,
              ...inspected,
              byteSize: bytes.length,
              storage,
              zipBase64: null,
              driveFileId: uploaded.fileId,
              driveAccountId: uploaded.accountId,
            })
            .returning({ id: schema.softwareAttachments.id });
          await audit(
            tx,
            input.organizationId,
            user.id,
            'attachment.uploaded',
            {
              attachmentId: row!.id,
              sha256: inspected.sha256,
              scanStatus: inspected.scan.status,
            },
            request.id,
          );
          return { id: row!.id, reused: false };
        });
      } catch (error) {
        if (uploaded)
          await uploaded.cleanup().catch(() => {
            app.log.warn(
              { event: 'drive.upload.cleanup_failed' },
              'Drive upload cleanup failed',
            );
          });
        throw error;
      }
    },
  );
  app.delete(
    '/api/v1/organizations/:organizationId/attachments/:attachmentId',
    options(attachmentParams),
    async (request) => {
      const user = await requireUser(request);
      const { organizationId, attachmentId } = attachmentParams.parse(
        request.params,
      );
      return db.transaction(async (tx) => {
        await member(tx, organizationId, user, true);
        const [row] = await tx
          .select({ id: schema.softwareAttachments.id })
          .from(schema.softwareAttachments)
          .where(
            and(
              eq(schema.softwareAttachments.id, attachmentId),
              eq(schema.softwareAttachments.organizationId, organizationId),
            ),
          )
          .for('update');
        if (!row) throw unavailable();
        const [busy] = await tx
          .select({ id: schema.softwareOperations.id })
          .from(schema.softwareOperations)
          .where(
            sql`${schema.softwareOperations.command}->>'attachmentId' = ${attachmentId} and (${schema.softwareOperations.status} in ('running','unknown') or (${schema.softwareOperations.status} in ('preview','queued') and ${schema.softwareOperations.expiresAt} > now()))`,
          )
          .limit(1);
        if (busy)
          throw conflict(
            'Cancel or resolve pending operations before deleting this attachment.',
          );
        await tx
          .delete(schema.softwareAttachments)
          .where(eq(schema.softwareAttachments.id, attachmentId));
        await audit(
          tx,
          organizationId,
          user.id,
          'attachment.deleted',
          { attachmentId },
          request.id,
        );
        return { success: true };
      });
    },
  );
  async function expire(tx: Tx, siteId: string) {
    await tx
      .update(schema.softwareOperations)
      .set({ status: 'expired', finishedAt: new Date() })
      .where(
        and(
          eq(schema.softwareOperations.siteId, siteId),
          sql`${schema.softwareOperations.status} in ('preview','queued')`,
          sql`${schema.softwareOperations.expiresAt} < now()`,
        ),
      );
    await tx
      .update(schema.softwareOperations)
      .set({ status: 'unknown', resultCode: 'uncertain' })
      .where(
        and(
          eq(schema.softwareOperations.siteId, siteId),
          eq(schema.softwareOperations.status, 'running'),
          sql`${schema.softwareOperations.startedAt} < now() - interval '15 minutes'`,
        ),
      );
  }
  app.get(
    '/api/v1/organizations/:organizationId/software',
    options(organizationParams),
    async (request) => {
      const user = await requireUser(request);
      const { organizationId } = organizationParams.parse(request.params);
      return db.transaction(async (tx) => {
        const membership = await member(tx, organizationId, user);
        const sites = await tx
          .select({
            site: schema.sites,
            management: schema.siteManagement,
            inventory: schema.siteInventorySnapshots,
            credential: schema.siteCredentials,
          })
          .from(schema.sites)
          .leftJoin(
            schema.siteManagement,
            eq(schema.siteManagement.siteId, schema.sites.id),
          )
          .leftJoin(
            schema.siteInventorySnapshots,
            eq(schema.siteInventorySnapshots.siteId, schema.sites.id),
          )
          .leftJoin(
            schema.siteCredentials,
            eq(schema.siteCredentials.siteId, schema.sites.id),
          )
          .where(
            and(
              eq(schema.sites.organizationId, organizationId),
              sql`${schema.sites.deletedAt} is null`,
            ),
          )
          .limit(1000);
        const operationQuery = () =>
          tx
            .select({
              operation: schema.softwareOperations,
              siteName: schema.sites.name,
            })
            .from(schema.softwareOperations)
            .innerJoin(
              schema.sites,
              eq(schema.sites.id, schema.softwareOperations.siteId),
            );
        // Preview history must never push a live site lock out of the UI feed.
        const outstanding = await operationQuery().where(
          and(
            eq(schema.sites.organizationId, organizationId),
            sql`${schema.softwareOperations.status} in ('queued','running','unknown')`,
          ),
        );
        const recent = await operationQuery()
          .where(eq(schema.sites.organizationId, organizationId))
          .orderBy(desc(schema.softwareOperations.createdAt))
          .limit(100);
        const operations = [
          ...new Map(
            [...outstanding, ...recent].map((row) => [row.operation.id, row]),
          ).values(),
        ].sort(
          (a, b) =>
            b.operation.createdAt.getTime() - a.operation.createdAt.getTime(),
        );
        return {
          canManage:
            user.emailVerified && canManageOrganization(membership.role),
          sites: sites.map(({ site, management, inventory, credential }) => ({
            id: site.id,
            name: site.name,
            canonicalUrl: site.canonicalUrl,
            packageSupport: !!management?.packageSupport,
            enabled:
              site.status === 'active' &&
              !!management?.enabled &&
              !!credential &&
              !credential.revokedAt &&
              management.secretVersion === credential.secretVersion &&
              management.polledAt >= minutes(-5),
            polledAt: management?.polledAt ?? null,
            inventoryAt: inventory?.receivedAt ?? null,
            canSync:
              site.status === 'active' && !!credential && !credential.revokedAt,
            inventorySync: (() => {
              const current =
                credential &&
                !credential.revokedAt &&
                management?.secretVersion === credential.secretVersion
                  ? management
                  : null;
              return {
                status: current?.inventoryRequestId
                  ? current.inventoryRequestedAt! < minutes(-15)
                    ? 'timed_out'
                    : 'pending'
                  : current?.inventoryError
                    ? 'failed'
                    : inventory
                      ? 'succeeded'
                      : 'not_received',
                requestedAt: current?.inventoryRequestedAt ?? null,
                attemptedAt: current?.inventoryAttemptAt ?? null,
                error: current?.inventoryError ?? null,
              };
            })(),
            plugins: inventory?.installedPlugins ?? [],
            themes: inventory?.installedThemes ?? [],
          })),
          operations: operations.map(({ operation: op, siteName }) => ({
            ...op.command,
            id: op.id,
            batchId: op.batchId,
            siteId: op.siteId,
            siteName,
            status:
              op.status === 'running' &&
              op.startedAt &&
              op.startedAt < minutes(-15)
                ? 'unknown'
                : ['preview', 'queued'].includes(op.status) &&
                    op.expiresAt < new Date()
                  ? 'expired'
                  : op.status,
            resultCode: op.resultCode,
            reason: op.reason,
            createdAt: op.createdAt,
          })),
        };
      });
    },
  );
  app.post(
    '/api/v1/organizations/:organizationId/software/inventory-sync',
    options(organizationParams, inventorySync),
    async (request) => {
      const user = await requireUser(request);
      const { organizationId } = organizationParams.parse(request.params);
      const input = inventorySync.parse(request.body);
      return db.transaction(async (tx) => {
        await member(tx, organizationId, user, true);
        const { site, credential, capability } = await context(
          tx,
          organizationId,
          input.siteId,
        );
        if (site.status !== 'active' || !credential || credential.revokedAt)
          throw conflict(
            'Pair an active Connector before requesting inventory.',
          );
        const current =
          capability?.secretVersion === credential.secretVersion
            ? capability
            : null;
        if (
          current?.inventoryRequestId &&
          current.inventoryRequestedAt! >= minutes(-15)
        )
          return { requestId: current.inventoryRequestId };
        if (
          current?.inventoryRequestedAt &&
          current.inventoryRequestedAt >= minutes(-1)
        )
          throw new HttpError(
            429,
            'SYNC_RATE_LIMIT',
            'Wait one minute before requesting inventory again.',
          );
        const requestId = randomUUID();
        const fields = {
          inventoryRequestId: requestId,
          inventoryRequestedAt: new Date(),
          inventoryError: null,
        };
        await tx
          .insert(schema.siteManagement)
          .values({
            siteId: site.id,
            secretVersion: credential.secretVersion,
            polledAt: new Date(0),
            ...fields,
          })
          .onConflictDoUpdate({
            target: schema.siteManagement.siteId,
            set: {
              ...fields,
              ...(current
                ? {}
                : {
                    secretVersion: credential.secretVersion,
                    enabled: false,
                    polledAt: new Date(0),
                    inventoryAttemptAt: null,
                  }),
            },
          });
        await audit(
          tx,
          organizationId,
          user.id,
          'inventory.sync_requested',
          { siteId: site.id, requestId },
          request.id,
        );
        return { requestId };
      });
    },
  );
  app.post(
    '/api/v1/organizations/:organizationId/software/preview',
    options(organizationParams, softwarePreview),
    async (request) => {
      const user = await requireUser(request);
      const { organizationId } = organizationParams.parse(request.params);
      const input = softwarePreview.parse(request.body);
      const batchId = randomUUID();
      return db.transaction(async (tx) => {
        await member(tx, organizationId, user, true);
        const impact = [];
        await attachment(tx, organizationId, input.command);
        for (const siteId of [...input.siteIds].sort()) {
          const value = await context(tx, organizationId, siteId);
          const fingerprint = ready(value, input.command);
          await tx.insert(schema.softwareOperations).values({
            batchId,
            siteId,
            actorUserId: user.id,
            command: input.command,
            reason: input.reason,
            fingerprint,
            secretVersion: value.credential!.secretVersion,
            expiresAt: minutes(10),
          });
          impact.push({ siteId, name: value.site.name });
        }
        await audit(
          tx,
          organizationId,
          user.id,
          'software.previewed',
          {
            batchId,
            command: input.command,
            siteIds: input.siteIds,
            reason: input.reason,
          },
          request.id,
        );
        return {
          batchId,
          impact,
          command: input.command,
          warning:
            'WordPress code changes may interrupt service or delete plugin data. Back up each site first. No automatic rollback.',
        };
      });
    },
  );
  for (const action of ['confirm', 'cancel', 'resolve'] as const) {
    app.post(
      `/api/v1/organizations/:organizationId/software/:batchId/${action}`,
      options(softwareBatchParams, emptyRequest),
      async (request) => {
        const user = await requireUser(request);
        const { organizationId, batchId } = softwareBatchParams.parse(
          request.params,
        );
        emptyRequest.parse(request.body);
        return db.transaction(async (tx) => {
          await member(tx, organizationId, user, true);
          const rows = await tx
            .select({ operation: schema.softwareOperations })
            .from(schema.softwareOperations)
            .innerJoin(
              schema.sites,
              eq(schema.sites.id, schema.softwareOperations.siteId),
            )
            .where(
              and(
                eq(schema.softwareOperations.batchId, batchId),
                eq(schema.sites.organizationId, organizationId),
              ),
            )
            .orderBy(schema.softwareOperations.siteId);
          if (!rows.length) throw unavailable();
          for (const { operation: original } of rows) {
            const value = await context(tx, organizationId, original.siteId);
            await expire(tx, original.siteId);
            const [op] = await tx
              .select()
              .from(schema.softwareOperations)
              .where(eq(schema.softwareOperations.id, original.id))
              .for('update');
            if (!op) throw unavailable();
            if (action === 'confirm') {
              await attachment(tx, organizationId, op.command);
              if (op.actorUserId !== user.id)
                throw new HttpError(
                  403,
                  'FORBIDDEN',
                  'Only the preview author can confirm it.',
                );
              if (op.status !== 'preview') {
                if (op.status === 'expired')
                  throw conflict('Preview expired. Create a new preview.');
                continue;
              }
              if (ready(value, op.command) !== op.fingerprint)
                throw conflict(
                  'The inventory or connection changed. Create a fresh preview.',
                );
              const [busy] = await tx
                .select({ id: schema.softwareOperations.id })
                .from(schema.softwareOperations)
                .where(
                  and(
                    eq(schema.softwareOperations.siteId, op.siteId),
                    sql`${schema.softwareOperations.status} in ('queued','running','unknown')`,
                  ),
                )
                .limit(1);
              if (busy)
                throw conflict(
                  'A site has a pending operation. Resolve it first.',
                );
              await tx
                .update(schema.softwareOperations)
                .set({ status: 'queued', expiresAt: minutes(60) })
                .where(eq(schema.softwareOperations.id, op.id));
            } else if (
              (action === 'cancel' &&
                ['preview', 'queued'].includes(op.status)) ||
              (action === 'resolve' && op.status === 'unknown')
            ) {
              await tx
                .update(schema.softwareOperations)
                .set({ status: 'cancelled', finishedAt: new Date() })
                .where(eq(schema.softwareOperations.id, op.id));
            }
          }
          await audit(
            tx,
            organizationId,
            user.id,
            `software.${action}`,
            { batchId },
            request.id,
          );
          return { success: true };
        });
      },
    );
  }
  async function connector(tx: Tx, request: FastifyRequest, siteId: string) {
    const bearer = request.headers.authorization?.match(
      /^Bearer ([A-Za-z0-9_-]{43})$/,
    )?.[1];
    const [site] = await tx
      .select()
      .from(schema.sites)
      .where(eq(schema.sites.id, siteId))
      .for('update');
    const [credential] = await tx
      .select()
      .from(schema.siteCredentials)
      .where(eq(schema.siteCredentials.siteId, siteId))
      .for('share');
    if (
      !bearer ||
      !site ||
      site.deletedAt ||
      site.status === 'disconnected' ||
      !credential ||
      credential.revokedAt ||
      credential.credentialHash !== hashCredential(bearer)
    )
      throw new HttpError(
        401,
        'INVALID_CREDENTIAL',
        'Invalid Connector credential.',
      );
    return { site, credential };
  }
  app.post(
    '/api/v1/connector/software-poll',
    { schema: { body: json(softwarePoll), tags: ['Connector'] } },
    async (request) => {
      const input = softwarePoll.parse(request.body);
      return db.transaction(async (tx) => {
        const { site, credential } = await connector(tx, request, input.siteId);
        const [previous] = await tx
          .select()
          .from(schema.siteManagement)
          .where(eq(schema.siteManagement.siteId, site.id));
        const generationChanged =
          previous && previous.secretVersion !== credential.secretVersion;
        await tx
          .insert(schema.siteManagement)
          .values({
            siteId: site.id,
            enabled: input.enabled,
            packageSupport: input.packageSupport === 1,
            secretVersion: credential.secretVersion,
          })
          .onConflictDoUpdate({
            target: schema.siteManagement.siteId,
            set: {
              enabled: input.enabled,
              packageSupport: input.packageSupport === 1,
              secretVersion: credential.secretVersion,
              polledAt: new Date(),
              ...(generationChanged
                ? {
                    inventoryRequestId: null,
                    inventoryRequestedAt: null,
                    inventoryAttemptAt: null,
                    inventoryError: null,
                  }
                : {}),
            },
          });
        if (
          !generationChanged &&
          previous?.inventoryRequestId &&
          previous.inventoryRequestedAt! >= minutes(-15)
        ) {
          // Never lease a mutating command while a potentially slow read-only sync is requested.
          return {
            command: null,
            inventoryRequestId: previous.inventoryRequestId,
          };
        }
        await expire(tx, site.id);
        const [op] = await tx
          .select()
          .from(schema.softwareOperations)
          .where(
            and(
              eq(schema.softwareOperations.siteId, site.id),
              sql`${schema.softwareOperations.status} in ('queued','running')`,
            ),
          )
          .for('update');
        if (!op) return { command: null };
        // A running operation is never reassigned, including after rotation or a timeout.
        if (op.status === 'running') return { command: null };
        const [actor] = await tx
          .select()
          .from(schema.users)
          .where(eq(schema.users.id, op.actorUserId))
          .for('share');
        const [membership] = await tx
          .select()
          .from(schema.organizationMembers)
          .where(
            and(
              eq(
                schema.organizationMembers.organizationId,
                site.organizationId,
              ),
              eq(schema.organizationMembers.userId, op.actorUserId),
            ),
          )
          .for('share');
        if (
          !input.enabled ||
          op.secretVersion !== credential.secretVersion ||
          !actor?.emailVerified ||
          !membership ||
          !canManageOrganization(membership.role)
        ) {
          await tx
            .update(schema.softwareOperations)
            .set({ status: 'cancelled', finishedAt: new Date() })
            .where(eq(schema.softwareOperations.id, op.id));
          await audit(
            tx,
            site.organizationId,
            null,
            'software.dispatch_cancelled',
            { operationId: op.id },
            request.id,
          );
          return { command: null };
        }
        const value = await context(tx, site.organizationId, site.id);
        let valid = false;
        try {
          await attachment(tx, site.organizationId, op.command);
          valid = ready(value, op.command) === op.fingerprint;
        } catch (error) {
          if (!(error instanceof HttpError)) throw error;
        }
        if (!valid) {
          await tx
            .update(schema.softwareOperations)
            .set({ status: 'cancelled', finishedAt: new Date() })
            .where(eq(schema.softwareOperations.id, op.id));
          return { command: null };
        }
        const token = randomBytes(32).toString('base64url');
        await tx
          .update(schema.softwareOperations)
          .set({ status: 'running', startedAt: new Date(), token })
          .where(eq(schema.softwareOperations.id, op.id));
        await audit(
          tx,
          site.organizationId,
          op.actorUserId,
          'software.dispatched',
          { operationId: op.id, command: op.command },
          request.id,
        );
        return {
          command: {
            ...op.command,
            ...(op.command.attachmentId
              ? {
                  packageSha256: (await attachment(
                    tx,
                    site.organizationId,
                    op.command,
                  ))!.sha256,
                }
              : {}),
            id: op.id,
            token,
            executeBefore: minutes(1).toISOString(),
          },
        };
      });
    },
  );
  app.post(
    '/api/v1/connector/software-package',
    { schema: { body: json(softwarePackage), tags: ['Connector'] } },
    async (request, reply) => {
      const input = softwarePackage.parse(request.body);
      const bytes = await db.transaction(async (tx) => {
        const { site, credential } = await connector(tx, request, input.siteId);
        const [op] = await tx
          .select()
          .from(schema.softwareOperations)
          .where(
            and(
              eq(schema.softwareOperations.id, input.operationId),
              eq(schema.softwareOperations.siteId, site.id),
            ),
          )
          .for('share');
        if (
          !op ||
          op.status !== 'running' ||
          op.token !== input.token ||
          op.secretVersion !== credential.secretVersion ||
          !op.startedAt ||
          op.startedAt < minutes(-2) ||
          !op.command.attachmentId
        )
          throw unavailable();
        const [actor] = await tx
          .select({
            id: schema.users.id,
            emailVerified: schema.users.emailVerified,
          })
          .from(schema.users)
          .where(eq(schema.users.id, op.actorUserId))
          .for('share');
        if (!actor) throw unavailable();
        await member(tx, site.organizationId, actor, true);
        const value = await context(tx, site.organizationId, site.id);
        ready(value, op.command);
        const row = (await attachment(tx, site.organizationId, op.command))!;
        const data =
          row.storage === 'google_drive'
            ? await drive.download(row)
            : Buffer.from(row.zipBase64!, 'base64');
        if (
          data.length !== row.byteSize ||
          data.length > PACKAGE_LIMIT ||
          createHash('sha256').update(data).digest('hex') !== row.sha256
        )
          throw conflict('Package integrity check failed.');
        return data;
      });
      return reply
        .type('application/zip')
        .header('content-disposition', 'attachment; filename="package.zip"')
        .send(bytes);
    },
  );
  app.post(
    '/api/v1/connector/inventory-failure',
    { schema: { body: json(inventoryFailure), tags: ['Connector'] } },
    async (request) => {
      const input = inventoryFailure.parse(request.body);
      return db.transaction(async (tx) => {
        const { site, credential } = await connector(tx, request, input.siteId);
        const [current] = await tx
          .select()
          .from(schema.siteManagement)
          .where(eq(schema.siteManagement.siteId, site.id));
        if (
          input.inventoryRequestId &&
          (current?.secretVersion !== credential.secretVersion ||
            current.inventoryRequestId !== input.inventoryRequestId)
        )
          throw unavailable();
        const fields = {
          inventoryAttemptAt: new Date(),
          inventoryError: input.code,
        };
        await tx
          .insert(schema.siteManagement)
          .values({
            siteId: site.id,
            secretVersion: credential.secretVersion,
            polledAt: new Date(0),
            ...fields,
          })
          .onConflictDoUpdate({
            target: schema.siteManagement.siteId,
            set: {
              ...fields,
              ...(current?.secretVersion !== credential.secretVersion
                ? {
                    secretVersion: credential.secretVersion,
                    enabled: false,
                    polledAt: new Date(0),
                    inventoryRequestId: null,
                    inventoryRequestedAt: null,
                  }
                : input.inventoryRequestId
                  ? { inventoryRequestId: null }
                  : {}),
            },
          });
        return { success: true };
      });
    },
  );
  app.post(
    '/api/v1/connector/software-result',
    { schema: { body: json(softwareResult), tags: ['Connector'] } },
    async (request) => {
      const input = softwareResult.parse(request.body);
      return db.transaction(async (tx) => {
        const { site, credential } = await connector(tx, request, input.siteId);
        const [op] = await tx
          .select()
          .from(schema.softwareOperations)
          .where(
            and(
              eq(schema.softwareOperations.id, input.operationId),
              eq(schema.softwareOperations.siteId, site.id),
            ),
          )
          .for('update');
        if (
          !op ||
          op.token !== input.token ||
          op.secretVersion !== credential.secretVersion
        )
          throw unavailable();
        if (['succeeded', 'failed'].includes(op.status)) {
          if (op.resultCode !== input.code)
            throw conflict('A different result was already recorded.');
          return { success: true };
        }
        if (!['running', 'unknown'].includes(op.status))
          throw conflict('This operation no longer accepts results.');
        const status =
          input.code === 'ok'
            ? 'succeeded'
            : input.code === 'uncertain'
              ? 'unknown'
              : 'failed';
        await tx
          .update(schema.softwareOperations)
          .set({ status, resultCode: input.code, finishedAt: new Date() })
          .where(eq(schema.softwareOperations.id, op.id));
        await audit(
          tx,
          site.organizationId,
          op.actorUserId,
          'software.completed',
          { operationId: op.id, status, code: input.code },
          request.id,
        );
        return { success: true };
      });
    },
  );
}
