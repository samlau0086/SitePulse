import { z } from 'zod';

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
