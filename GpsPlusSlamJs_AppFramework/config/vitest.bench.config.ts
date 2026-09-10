import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  test: {
    // Same setup as the test config: activates the gps-plus-slam-js license
    // so benched code paths (e.g. calcGpsCoords) don't throw on
    // assertLicenseActive(). Tinybench swallows per-iteration errors, so a
    // missing setup surfaces as empty samples, not a failed run.
    setupFiles: [
      fileURLToPath(new URL('../src/test-setup.ts', import.meta.url)),
    ],
    // Vitest 5 runs each benchmark inside a test, so the TEST timeout bounds
    // it - Vitest 4's bare bench() had no such bound, and tinybench 6 raised
    // the default time budget (1 s per task, 64 iterations minimum) on top.
    // A ceiling, not a measurement: it restores the old effectively
    // unbounded behaviour rather than asserting how long a bench may take
    // (the Osm config sized it first; PR #433 review).
    testTimeout: 600_000,
    benchmark: {
      include: ['src/**/*.bench.ts'],
      // Vitest 5 dropped benchmark.outputJson (and the CLI flags); a bench
      // persists a result with its own writeResult option when a comparison
      // needs one. Nothing read the old JSON (harness-majors plan M1b).
    },
  },
});
