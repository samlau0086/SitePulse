import { z } from 'zod';

export const planCode = z.enum(['free', 'pro', 'agency', 'agency_plus']);
// Operator-only input; never accepted by organization mutation routes.
export const entitlementChange = z
  .object({
    organizationId: z.uuid(),
    planCode,
    siteLimitOverride: z.number().int().min(0).max(1000).nullable(),
    operator: z.string().trim().min(1).max(100),
    reason: z.string().trim().min(1).max(300),
  })
  .strict();
export type OrganizationUsage = {
  planCode: z.infer<typeof planCode>;
  siteLimit: number;
  siteLimitOverride: number | null;
  sitesUsed: number;
  sitesRemaining: number;
  canAddSite: boolean;
  overLimit: boolean;
};

export const adminWorkspaceSearch = z
  .object({
    q: z.string().trim().max(100).default(''),
    page: z
      .string()
      .regex(/^[1-9][0-9]{0,4}$/)
      .default('1'),
  })
  .strict();
export const adminEntitlementPreview = z
  .object({
    planCode,
    siteLimitOverride: z.number().int().min(0).max(1000).nullable(),
    reason: z.string().trim().min(1).max(300),
  })
  .strict();
export const entitlementSnapshot = z
  .object({
    planCode,
    siteLimitOverride: z.number().int().min(0).max(1000).nullable(),
    sitesUsed: z.number().int().nonnegative(),
    updatedAt: z.iso.datetime(),
  })
  .strict();
export const adminEntitlementSave = adminEntitlementPreview
  .extend({
    expected: entitlementSnapshot,
  })
  .strict();
export type AdminWorkspace = {
  id: string;
  name: string;
  slug: string;
  usage: OrganizationUsage;
};
export type EntitlementPreview = {
  before: OrganizationUsage;
  after: OrganizationUsage;
  expected: z.infer<typeof entitlementSnapshot>;
};

const email = z.email().max(254).trim().toLowerCase();
// Long passphrases are accepted; no silent truncation or character-class rules.
const password = z.string().min(12).max(128);
export const requestAuthEmail = z.object({ email }).strict();
export const authToken = z.string().min(1).max(2048);
export const resetPassword = z
  .object({ token: authToken, newPassword: password })
  .strict();
export const verifyEmail = z.object({ token: authToken }).strict();
export const registration = z
  .object({ email, password, name: z.string().trim().min(1).max(100) })
  .strict();
export const login = z
  .object({ email, password: z.string().min(1).max(128) })
  .strict();
export const createOrganization = z
  .object({
    name: z.string().trim().min(1).max(100),
    slug: z
      .string()
      .min(3)
      .max(63)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  })
  .strict();
export const updateOrganization = z
  .object({ name: z.string().trim().min(1).max(100) })
  .strict();
export const organizationParams = z.object({ organizationId: z.uuid() });
export const emptyRequest = z.object({}).strict();
export const notificationEndpointParams = organizationParams
  .extend({ endpointId: z.uuid() })
  .strict();
export const createNotificationEndpoint = z
  .object({
    destination: z.string().trim().toLowerCase().pipe(z.email().max(254)),
  })
  .strict();
export const createBarkEndpoint = z
  .object({
    label: z.string().trim().min(1).max(80),
    deviceKey: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9_-]{8,256}$/),
  })
  .strict();
export const updateNotificationEndpoint = z
  .object({ enabled: z.boolean() })
  .strict();
export const updateNotificationSettings = z
  .object({ includeMembers: z.boolean() })
  .strict();
export const confirmNotificationEndpoint = z
  .object({
    endpointId: z.uuid(),
    token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  })
  .strict();
export type NotificationEndpoint = {
  id: string;
  type: 'email' | 'bark';
  label: string | null;
  destination: string;
  enabled: boolean;
  verifiedAt: string | null;
  lastMailAt: string | null;
};
export type NotificationConfiguration = {
  includeMembers: boolean;
  canManage: boolean;
  memberEmails: string[];
  endpoints: NotificationEndpoint[];
};
export const createSite = z
  .object({
    name: z.string().trim().min(1).max(100),
    canonicalUrl: z.string().url().max(2048),
  })
  .strict();
export const updateSite = z
  .object({ name: z.string().trim().min(1).max(100) })
  .strict();
export const siteParams = z.object({ siteId: z.uuid() }).strict();
export const incidentParams = z
  .object({ siteId: z.uuid(), incidentId: z.uuid() })
  .strict();
export const connectorPair = z
  .object({
    challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    canonicalUrl: z.string().url().max(2048),
  })
  .strict();
export const connectorHeartbeat = z
  .object({
    siteId: z.uuid(),
    sequence: z.number().int().min(1).max(2147483647),
    connectorVersion: z
      .string()
      .regex(/^\d+\.\d+\.\d+$/)
      .max(32),
  })
  .strict();
const inventoryItem = z
  .object({
    identifier: z.string().trim().min(1).max(100),
    name: z.string().trim().min(1).max(150),
    version: z
      .string()
      .trim()
      .regex(/^[0-9A-Za-z.+_-]{1,40}$/),
  })
  .strict();
export const connectorInventory = z
  .object({
    siteId: z.uuid(),
    wordpressVersion: z
      .string()
      .regex(/^\d+\.\d+(?:\.\d+)?$/)
      .max(32),
    phpVersion: z
      .string()
      .regex(/^\d+\.\d+(?:\.\d+)?$/)
      .max(32),
    activePlugins: z.array(inventoryItem).max(200),
    activeThemes: z.array(inventoryItem).max(20),
    updateCounts: z
      .object({
        plugins: z.number().int().min(0).max(10000),
        themes: z.number().int().min(0).max(10000),
        core: z.number().int().min(0).max(100),
      })
      .strict(),
  })
  .strict();
export type InventoryItem = z.infer<typeof inventoryItem>;
export type SiteInventory = z.infer<typeof connectorInventory> & {
  receivedAt: string;
};
export type Site = {
  id: string;
  organizationId: string;
  name: string;
  canonicalUrl: string;
  hostname: string;
  status: 'pending' | 'active' | 'degraded' | 'disconnected';
  lastSeenAt: string | null;
  connectorVersion: string | null;
};
export type Organization = {
  id: string;
  name: string;
  slug: string;
  role: 'owner' | 'admin' | 'member';
};
export type ApiError = {
  error: { code: string; message: string; requestId: string };
};
export type MonitorCheck = {
  id: string;
  siteId: string;
  monitorType: 'uptime' | 'ssl';
  checkedAt: string;
  result: 'up' | 'down' | 'warning' | 'error';
  httpStatus: number | null;
  latencyMs: number | null;
  sslExpiresAt: string | null;
  errorCode: string | null;
};
export type MonitorState = {
  monitorType: 'uptime' | 'ssl';
  state:
    'pending' | 'healthy' | 'suspected' | 'down' | 'recovering' | 'warning';
  lastCheckedAt: string | null;
  nextRunAt: string;
};
export type Incident = {
  id: string;
  siteId: string;
  monitorType: 'uptime' | 'ssl' | 'stale_data';
  status: 'open' | 'acknowledged' | 'resolved';
  severity: 'warning' | 'critical';
  startedAt: string;
  resolvedAt: string | null;
  resolutionReason: 'recovered' | 'connection_reset' | null;
};
