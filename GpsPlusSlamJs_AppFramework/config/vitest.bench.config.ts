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
    benchmark: {
      include: ['src/**/*.bench.ts'],
      // Vitest 5 dropped benchmark.outputJson (and the CLI flags); a bench
      // persists a result with its own writeResult option when a comparison
      // needs one. Nothing read the old JSON (harness-majors plan M1b).
    },
  },
});
