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
  })
  .strict()
  .superRefine((value, ctx) => {
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
  .object({ siteId: z.uuid(), enabled: z.boolean() })
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
    polledAt: string | null;
    inventoryAt: string | null;
    plugins: import('./index').InstalledComponent[];
    themes: import('./index').InstalledComponent[];
  }>;
  operations: SoftwareOperation[];
};
