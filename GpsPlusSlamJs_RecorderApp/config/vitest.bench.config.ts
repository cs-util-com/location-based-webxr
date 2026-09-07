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
    benchmark: {
      include: ['src/**/*.bench.ts'],
      // Vitest 5 dropped benchmark.outputJson (and the CLI flags); a bench
      // persists a result with its own writeResult option when a comparison
      // needs one. Nothing read the old JSON (harness-majors plan M1b).
    },
  },
});
