import { afterEach, expect, it, vi } from 'vitest';
import type { Database } from '@sitepulse/database';
import { parseEnvironment } from '@sitepulse/config';
import type { Auth } from './auth';
import { createDriveStorage } from './google-drive';

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it.each([
  { headersMs: 21_000, bodyMs: 300, succeeds: true },
  { headersMs: 46_000, bodyMs: 0, succeeds: false },
  { headersMs: 21_000, bodyMs: 25_000, succeeds: false },
])(
  'bounds slow media headers and body: %j',
  async ({ headersMs, bodyMs, succeeds }) => {
    vi.useFakeTimers();
    // Model fetch cancellation with controllable timers, including after headers.
    vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms) => {
      const controller = new AbortController();
      setTimeout(
        () => controller.abort(new DOMException('', 'TimeoutError')),
        ms,
      );
      return controller.signal;
    });
    const db = {
      select: () => ({
        from: () => ({
          where: async () => [
            {
              id: 'account-row',
              refreshToken: 'fixture-refresh',
              scope: null,
            },
          ],
        }),
      }),
    } as unknown as Database;
    const auth = {
      api: { getAccessToken: async () => ({ accessToken: 'fixture-access' }) },
    } as unknown as Auth;
    const env = parseEnvironment({
      NODE_ENV: 'test',
      DATABASE_URL: 'postgres://localhost/unused_test',
      APP_ORIGIN: 'http://localhost:3000',
      BETTER_AUTH_SECRET: 'x'.repeat(48),
      GOOGLE_DRIVE_CLIENT_ID: 'fixture',
      GOOGLE_DRIVE_CLIENT_SECRET: 'fixture',
    });
    const transport: typeof fetch = async (_input, init) => {
      const signal = init!.signal!;
      await new Promise<void>((resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), {
          once: true,
        });
        setTimeout(resolve, headersMs);
      });
      return new Response(
        new ReadableStream({
          start(controller) {
            signal.addEventListener(
              'abort',
              () => controller.error(signal.reason),
              { once: true },
            );
            setTimeout(() => {
              if (signal.aborted) return;
              controller.enqueue(new Uint8Array([1, 2, 3]));
              controller.close();
            }, bodyMs);
          },
        }),
      );
    };
    const storage = createDriveStorage(db, auth, env, transport);
    const download = storage.download({
      actorUserId: 'uploader',
      driveAccountId: 'google-subject',
      driveFileId: 'file',
      byteSize: 3,
    } as Parameters<typeof storage.download>[0]);
    const assertion = succeeds
      ? expect(download).resolves.toEqual(Buffer.from([1, 2, 3]))
      : expect(download).rejects.toMatchObject({ reason: 'timeout' });
    await vi.advanceTimersByTimeAsync(46_000);
    await assertion;
  },
);
