import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: [
      'src/**/*.test.ts',
      'src/**/*.spec.ts',
      // Pick up node-only `.mjs` script tests (e.g. the pre-publish
      // guardrails under `scripts/`). They share the project's `node`
      // environment but live outside `src/`.
      'scripts/**/*.test.mjs',
    ],
    setupFiles: [
      fileURLToPath(new URL('../src/test-setup.ts', import.meta.url)),
    ],
    silent: true,
    // RAISED FROM THE 5 s DEFAULT ON 2026-08-11, for the reason spelled out in
    // `GpsPlusSlamJs_Osm/config/vitest.config.ts` — kept in step deliberately,
    // since the root cascade gates both packages concurrently and the failure
    // was a property of that concurrency rather than of either package.
    //
    // The case from this side: `occupancy-mesher.property`'s
    // "emits in-range indices and finite positions" measures 1 221 ms alone —
    // four times inside the old limit, which sounds safe and was not. It timed
    // out in the cascade and passed 9/9 immediately afterwards standalone. 37
    // property tests live here, and a fast-check property's cost scales with
    // whatever it generates, so they have the least margin of anything in the
    // suite.
    //
    // A deadlock guard, not a performance gate: slowdowns are caught by
    // `docs/test-timings.md`, which flags them 🔺 whatever this number says.
    testTimeout: 30_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.spec.ts',
        'src/**/index.ts',
        // Benchmarks are measurement instruments, not code under test.
        'src/**/*.bench.ts',
      ],
    },
  },
});
