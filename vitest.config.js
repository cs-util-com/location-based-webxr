import { defineConfig } from 'vitest/config';

// Root-level vitest config — runs repo-meta tests (e.g. CLA artifact
// consistency) plus the test-timing tooling's own unit/property tests
// (scripts/test-timing/ is not covered by any package gate, so without this
// include those tests would silently never run). Per-package tests still run
// via each workspace's own vitest config (e.g.
// GpsPlusSlamJs_AppFramework/config/vitest.config.ts).
export default defineConfig({
  test: {
    include: [
      'tests/**/*.test.js',
      'scripts/*.test.mjs',
      'scripts/test-timing/**/*.test.mjs',
      'scripts/test-changed/**/*.test.mjs',
      'scripts/e2e/**/*.test.mjs',
    ],
    environment: 'node',
  },
});
