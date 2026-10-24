import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: [
            'packages/**/*.test.ts',
            'apps/api/src/**/*.test.ts',
            'apps/web/lib/**/*.test.ts',
          ],
          testTimeout: 15000,
        },
      },
      {
        test: {
          name: 'integration',
          include: ['apps/api/tests/**/*.test.ts'],
          fileParallelism: false,
          testTimeout: 30000,
          hookTimeout: 60000,
        },
      },
    ],
  },
});
