import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  resolve: {
    // Same alias as the main test config: bench files exercise app modules
    // that import the framework, and both configs must resolve it to the
    // sibling source tree, not a published dist.
    alias: {
      'gps-plus-slam-app-framework': fileURLToPath(
        new URL('../../GpsPlusSlamJs_AppFramework/src', import.meta.url)
      ),
    },
  },
  test: {
    // Vitest 5 runs each benchmark inside a test, so the TEST timeout bounds
    // it - Vitest 4's bare bench() had no such bound, and tinybench 6 raised
    // the default time budget on top of that. A ceiling, not a measurement:
    // it restores the old effectively unbounded behaviour rather than
    // asserting how long a bench may take (the Osm config sized it first;
    // PR #433 review).
    testTimeout: 600_000,
    benchmark: {
      include: ['src/**/*.bench.ts'],
      // Vitest 5 dropped benchmark.outputJson (and the CLI flags); a bench
      // persists a result with its own writeResult option when a comparison
      // needs one. Nothing read the old JSON (harness-majors plan M1b).
    },
  },
});
