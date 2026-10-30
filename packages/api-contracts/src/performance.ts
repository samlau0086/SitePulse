import { z } from 'zod';

export const performanceStrategy = z.enum(['mobile', 'desktop']);
export type PerformanceStrategy = z.infer<typeof performanceStrategy>;
const metric = z.number().finite().nonnegative().max(1e9).nullable();
export const performanceReport = z
  .object({
    score: z.number().int().min(0).max(100),
    analyzedAt: z.iso.datetime(),
    lighthouseVersion: z.string().min(1).max(40),
    metrics: z
      .object({
        fcpMs: metric,
        lcpMs: metric,
        speedIndexMs: metric,
        tbtMs: metric,
        cls: metric,
      })
      .strict(),
    opportunities: z
      .array(
        z
          .object({
            id: z.string().min(1).max(100),
            title: z.string().min(1).max(300),
            savingsMs: z.number().finite().nonnegative().max(1e9),
          })
          .strict(),
      )
      .max(5),
  })
  .strict();
export type PerformanceReport = z.infer<typeof performanceReport>;
export type PerformanceDevice = {
  strategy: PerformanceStrategy;
  state: 'pending' | 'queued' | 'running' | 'ready' | 'stale' | 'error';
  lastAttemptAt: string | null;
  nextRunAt: string | null;
  errorCode: string | null;
  report: PerformanceReport | null;
};
export type SitePerformance = {
  enabled: boolean;
  available: boolean;
  canRefresh: boolean;
  refreshAfter: string | null;
  devices: PerformanceDevice[];
  history: Array<{
    id: string;
    strategy: PerformanceStrategy;
    checkedAt: string;
    completedAt: string | null;
    score: number | null;
    errorCode: string | null;
  }>;
};
