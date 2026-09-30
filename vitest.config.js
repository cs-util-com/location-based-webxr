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
    // One worker runs many files instead of one process per file. Measured
    // 2026-09-30 (with tests/repo-config/tracked-tree.js): per run 79 -> 24
    // processes and ~22 -> ~10 CPU-s on a quiet machine (~33 -> ~17 beside a
    // 3D browser suite), because it lets tracked-tree.js serve one git
    // listing and one read per file to every guard in a worker. It does NOT
    // keep the suite green beside a sustained 3D suite at 90 %+ machine load;
    // see the 2026-09-30 repo-config-under-load results.
    // Safe because nothing here mutates shared state: the guards only read,
    // and the scripts tests use temp dirs and restore the one env var they
    // set (checked with shuffled file orders; see vitest.config.js.md).
    isolate: false,
  },
});
