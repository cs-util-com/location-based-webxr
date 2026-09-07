import { defineConfig } from "vitest/config";

/**
 * Benchmark-only project. Kept separate from `vitest.config.ts` so the gate's
 * `test:unit` stage never pays for benchmark runs, and so the comparison
 * harness (plan §4.2.1 — ours vs. the best-in-class library) can be run on
 * demand with `pnpm run bench`.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.bench.ts"],
    // Vitest 5 runs each benchmark inside a test, so the test timeout bounds
    // it - Vitest 4's bare bench() had no such bound. plates.bench.ts pins
    // tinybench 2's ten-iteration budget and still spends ~45 s on each of
    // its two ~2.9 s cases on a quiet machine; the 60 s default fails them
    // under load, so this restores the old unbounded behaviour in effect.
    testTimeout: 600_000,
  },
});
