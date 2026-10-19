import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['src/**/*.int-spec.ts'],
    setupFiles: ['./test/uploads-dir.ts'],
    globalSetup: ['./test/global-setup.ts'],
    // All files share one database; truncating between tests needs them to run one at a time.
    fileParallelism: false,
    hookTimeout: 120_000,
    testTimeout: 30_000,
  },
});
