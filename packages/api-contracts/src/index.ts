import { z } from 'zod';
import { validLogoUrl } from '@sitepulse/shared/email';
export { validLogoUrl } from '@sitepulse/shared/email';
export * from './software';
export * from './performance';

export const emailBrandInput = z
  .object({
    name: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .refine(
        (value) =>
          ![...value].some((character) => character.charCodeAt(0) < 32),
        'Brand name cannot contain control characters.',
      ),
    logoUrl: z
      .string()
      .refine(
        validLogoUrl,
        'Use a public HTTPS logo URL without credentials, port or fragment.',
      )
      .nullable(),
  })
  .strict();
export type EmailBrandSettings = z.infer<typeof emailBrandInput>;
export type AccountBrandSettings = {
  brand: EmailBrandSettings;
  platform: EmailBrandSettings;
  canCustomize: boolean;
};

export const userPreferences = z
  .object({
    timeZone: z
      .string()
      .min(1)
      .max(100)
      .refine((value) => {
        // Named zones carry daylight-saving rules; fixed numeric offsets do not.
        if (!/^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)*$/.test(value)) return false;
        try {
          new Intl.DateTimeFormat('en-GB', { timeZone: value });
          return true;
        } catch {
          return false;
        }
      }, 'Choose a valid IANA time zone.'),
  })
  .strict();
export type UserPreferences = z.infer<typeof userPreferences>;

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
// Strict official Slack endpoint: no credentials, ports, query, fragment or custom hosts.
export const slackWebhook = z
  .string()
  .trim()
  .max(512)
  .regex(
    /^https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+$/,
  );
export const telegramBotToken = z
  .string()
  .trim()
  .regex(/^[0-9]{5,20}:[A-Za-z0-9_-]{20,100}$/);
export const telegramChatId = z
  .string()
  .trim()
  .regex(/^-?[1-9][0-9]{0,19}$/);
export const createSlackEndpoint = z
  .object({
    label: z.string().trim().min(1).max(80),
    webhookUrl: slackWebhook,
  })
  .strict();
export const createTelegramEndpoint = z
  .object({
    label: z.string().trim().min(1).max(80),
    botToken: telegramBotToken,
    chatId: telegramChatId,
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
  type: 'email' | 'bark' | 'slack' | 'telegram';
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
      .regex(/^[0-9A-Za-z.+_ -]{1,40}$/),
  })
  .strict();
const installedComponent = inventoryItem
  .extend({
    active: z.boolean(),
    updateVersion: z
      .string()
      .trim()
      .regex(/^[0-9A-Za-z.+_ -]{1,40}$/)
      .nullable(),
    source: z.enum(['wordpress.org', 'custom', 'unknown']),
  })
  .strict();
const localSecurityFinding = z
  .object({
    rule: z.enum([
      'php_in_uploads',
      'encoded_eval',
      'encoded_inflate',
      'command_execution',
    ]),
    path: z
      .string()
      .trim()
      .min(1)
      .max(300)
      .refine(
        (value) =>
          !/^[\\/]|[\\:]/.test(value) &&
          !Array.from(value).some(
            (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
          ) &&
          !value
            .split('/')
            .some((part) => part === '..' || part === '.' || !part),
      ),
  })
  .strict();
const connectorEnvironment = z
  .object({
    environmentType: z.enum(['local', 'development', 'staging', 'production']),
    multisite: z.boolean(),
    wpDebug: z.boolean(),
    wpDebugDisplay: z.boolean(),
    scriptDebug: z.boolean(),
    disallowFileEdit: z.boolean(),
    forceSslAdmin: z.boolean(),
    wpCronDisabled: z.boolean(),
    inventoryComplete: z.boolean().optional(),
  })
  .strict();
const connectorLocalSecurityScan = z
  .object({
    status: z.enum(['complete', 'partial', 'unavailable']),
    scannedAt: z.iso.datetime().optional(),
    scannedFiles: z.number().int().min(0).max(5000),
    skippedFiles: z.number().int().min(0).max(1000000),
    findings: z.array(localSecurityFinding).max(100),
  })
  .strict();
export const connectorInventory = z
  .object({
    siteId: z.uuid(),
    inventoryRequestId: z.uuid().optional(),
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
    installedPlugins: z
      .array(installedComponent)
      .max(200)
      .nullable()
      .default(null),
    installedThemes: z
      .array(installedComponent)
      .max(20)
      .nullable()
      .default(null),
    environment: connectorEnvironment.nullable().default(null),
    localSecurityScan: connectorLocalSecurityScan.nullable().default(null),
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
export type InstalledComponent = z.infer<typeof installedComponent>;
export type ConnectorEnvironment = z.infer<typeof connectorEnvironment>;
export type LocalSecurityScan = z.infer<typeof connectorLocalSecurityScan>;
export type SiteInventory = z.infer<typeof connectorInventory> & {
  receivedAt: string;
};
export type PublicVulnerability = {
  componentType: 'wordpress' | 'php' | 'plugin' | 'theme';
  component: string;
  installedVersion: string;
  id: string;
  title: string;
  severity: 'unknown' | 'low' | 'medium' | 'high' | 'critical';
  fixedVersion: string | null;
  sourceUrl: string | null;
  supplyChain: boolean;
};

export function uniquePublicVulnerabilities<T extends PublicVulnerability>(
  findings: readonly T[],
): T[] {
  const seen = new Set<string>();
  return findings.filter((finding) => {
    const key = JSON.stringify([
      finding.componentType,
      finding.component,
      finding.installedVersion,
      finding.id,
      finding.title,
      finding.severity,
      finding.fixedVersion,
      finding.sourceUrl,
      finding.supplyChain,
    ]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
export type SiteSecurityReport = {
  status: 'current' | 'stale' | 'pending' | 'unavailable';
  checkedAt: string | null;
  nextCheckAt: string | null;
  coverage: {
    inventory: 'complete' | 'partial' | 'unknown';
    localFiles: 'complete' | 'partial' | 'unknown';
    publicVulnerabilities: 'complete' | 'partial' | 'unknown';
  };
  environmentRisks: Array<{
    code: string;
    severity: 'low' | 'medium' | 'high';
    message: string;
  }>;
  localFindings: LocalSecurityScan['findings'];
  vulnerabilities: PublicVulnerability[];
  errorCode: string | null;
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
export type SiteHealthSummary = {
  availability: {
    state:
      | 'up'
      | 'down'
      | 'suspected'
      | 'recovering'
      | 'pending'
      | 'stale'
      | 'disabled';
    lastCheckedAt: string | null;
  };
  security: {
    status: SiteSecurityReport['status'];
    coverage: SiteSecurityReport['coverage'];
    checkedAt: string | null;
    highestSeverity: PublicVulnerability['severity'] | null;
    environmentRisks: number;
    vulnerabilities: number;
    localIndicators: number;
  };
};
export type DirectorySite = Site & {
  health?: SiteHealthSummary;
  performance?: Pick<
    import('./performance').SitePerformance,
    'enabled' | 'devices'
  >;
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
