import { z } from 'zod';

export const softwareSlug = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .max(100);
export const softwareCommand = z
  .object({
    kind: z.enum(['plugin', 'theme']),
    action: z.enum([
      'install',
      'uninstall',
      'activate',
      'deactivate',
      'update',
    ]),
    slug: softwareSlug,
    replacement: softwareSlug.optional(),
    attachmentId: z.uuid().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.attachmentId && value.action !== 'install') {
      ctx.addIssue({
        code: 'custom',
        message: 'Attachments support installation only.',
      });
    }
    if (
      value.kind === 'theme' &&
      value.action === 'deactivate' &&
      !value.replacement
    ) {
      ctx.addIssue({ code: 'custom', message: 'Choose a replacement theme.' });
    }
    if (
      value.replacement &&
      (value.kind !== 'theme' ||
        value.action !== 'deactivate' ||
        value.replacement === value.slug)
    ) {
      ctx.addIssue({ code: 'custom', message: 'Invalid replacement theme.' });
    }
  });
export const softwarePreview = z
  .object({
    siteIds: z
      .array(z.uuid())
      .min(1)
      .max(20)
      .refine((ids) => new Set(ids).size === ids.length),
    command: softwareCommand,
    reason: z.string().trim().min(3).max(300),
  })
  .strict();
export const softwareBatchParams = z
  .object({ organizationId: z.uuid(), batchId: z.uuid() })
  .strict();
export const softwarePoll = z
  .object({
    siteId: z.uuid(),
    enabled: z.boolean(),
    packageSupport: z.literal(1).optional(),
  })
  .strict();
export const inventorySync = z.object({ siteId: z.uuid() }).strict();
export const inventoryFailure = z
  .object({
    siteId: z.uuid(),
    inventoryRequestId: z.uuid().optional(),
    code: z.enum(['network', 'rejected', 'collection']),
  })
  .strict();
export const softwareResultCode = z.enum([
  'ok',
  'disabled',
  'unsupported',
  'not_installed',
  'already_installed',
  'active',
  'dependency',
  'filesystem',
  'package',
  'wordpress_error',
  'uncertain',
]);
export const softwareResult = z
  .object({
    siteId: z.uuid(),
    operationId: z.uuid(),
    token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    code: softwareResultCode,
  })
  .strict();
export type SoftwareCommand = z.infer<typeof softwareCommand>;
export const attachmentUploadParams = z
  .object({
    organizationId: z.uuid(),
    kind: z.enum(['plugin', 'theme']),
  })
  .strict();
export const attachmentParams = z
  .object({ organizationId: z.uuid(), attachmentId: z.uuid() })
  .strict();
export const attachmentUploadQuery = z
  .object({
    storage: z.literal('google_drive').default('google_drive'),
  })
  .strict();
export const driveCallbackQuery = z
  .object({
    code: z.string().max(4096).optional(),
    state: z.string().max(4096).optional(),
    error: z.string().max(256).optional(),
    error_description: z.string().max(2048).optional(),
    scope: z.string().max(2048).optional(),
    authuser: z.string().max(32).optional(),
    prompt: z.string().max(64).optional(),
    iss: z.string().max(256).optional(),
  })
  .strict();
export type DriveConnection = { enabled: boolean; connected: boolean };
export const softwarePackage = z
  .object({
    siteId: z.uuid(),
    operationId: z.uuid(),
    token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  })
  .strict();
export type AttachmentScan = {
  version: string;
  status: 'complete' | 'blocked';
  scannedFiles: number;
  findings: Array<{ rule: string; path: string }>;
};
export type SoftwareAttachment = {
  storage?: 'database' | 'google_drive';
  id: string;
  kind: 'plugin' | 'theme';
  slug: string;
  name: string;
  version: string;
  sha256: string;
  byteSize: number;
  scan: AttachmentScan;
  createdAt: string;
};
export type AttachmentDirectory = {
  canManage: boolean;
  attachments: SoftwareAttachment[];
  usedBytes: number;
  limitBytes: number;
};
export type SoftwareOperation = SoftwareCommand & {
  id: string;
  batchId: string;
  siteId: string;
  siteName: string;
  status:
    | 'preview'
    | 'queued'
    | 'running'
    | 'succeeded'
    | 'failed'
    | 'unknown'
    | 'cancelled'
    | 'expired';
  resultCode: string | null;
  reason: string;
  createdAt: string;
};
export type SoftwareDirectory = {
  canManage: boolean;
  sites: Array<{
    id: string;
    name: string;
    canonicalUrl: string;
    enabled: boolean;
    packageSupport?: boolean;
    polledAt: string | null;
    inventoryAt: string | null;
    canSync: boolean;
    inventorySync: {
      status: 'not_received' | 'succeeded' | 'pending' | 'failed' | 'timed_out';
      requestedAt: string | null;
      attemptedAt: string | null;
      error: string | null;
    };
    plugins: import('./index').InstalledComponent[];
    themes: import('./index').InstalledComponent[];
  }>;
  operations: SoftwareOperation[];
};
