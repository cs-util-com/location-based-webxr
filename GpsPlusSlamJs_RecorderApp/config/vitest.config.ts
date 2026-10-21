import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      'gps-plus-slam-app-framework': fileURLToPath(
        new URL('../../GpsPlusSlamJs_AppFramework/src', import.meta.url)
      ),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    // The jsdom Blob.stream() polyfill zip.js 2.9+ needs (see the file).
    // The shared fast-check time limit (every interruption is red), so a
    // failing property cannot shrink for hours where testTimeout cannot
    // reach: scripts/test-timing/fast-check-time-limit.mjs.md.
    setupFiles: [
      'src/test-setup.ts',
      fileURLToPath(
        new URL(
          '../../scripts/test-timing/fast-check-time-limit.mjs',
          import.meta.url
        )
      ),
    ],
    include: ['src/**/*.test.ts', 'src/**/*.spec.ts'],
    // Suppress console.log/error output from tests to reduce noise.
    // Failing tests still show the assertion error and source context.
    // To see all console output for debugging, run with --silent=false:
    //   npm run test:unit -- --silent=false
    silent: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.spec.ts',
        'src/test-setup.ts',
        'src/main.ts',
        // Benchmarks are measurement instruments, not code under test.
        'src/**/*.bench.ts',
      ],
      thresholds: {
        statements: 87,
        branches: 75,
        functions: 87,
        lines: 88,
      },
    },
  },
});
