import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    // Pure-data package: no DOM, no jsdom. Anything that needs a browser API
    // (OPFS, Worker) lives in the consumer's bridge, not here — see the plan's
    // §4.2 dependency rules.
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.spec.ts"],
    silent: true,
    /**
     * Generous on purpose: **the default 5 s timeout is itself a wall-clock
     * assertion**, and this repo has already learned that a wall-clock
     * assertion inside a parallel suite measures the machine rather than the
     * code (the per-chunk cost test failed the root cascade at 104 ms against a
     * "generous" 100 ms ceiling, because a contended run is ~12x slower).
     *
     * The property tests here are correctness checks, not latency checks. They
     * finish in well under a second each when the package runs alone, and the
     * root cascade runs ten package gates concurrently — where this suite takes
     * 4x longer wall-clock. `cell-coverage.property.test.ts` already carries a
     * comment from an earlier session about having "blown the per-test budget
     * under parallel load", and it intermittently failed the cascade again
     * (twice in three runs) while passing 31 consecutive standalone runs.
     *
     * **Honest caveat:** the failing run's message was never captured, so
     * "timeout under contention" is the best-supported explanation rather than
     * a proven one. This change cannot mask a real counterexample — a failed
     * assertion still fails, however long the budget — so it is safe either
     * way. If it recurs, capture the failure text before doing anything else.
     */
    testTimeout: 30_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.test.ts",
        "src/**/*.spec.ts",
        "src/**/index.ts",
        // Benchmarks are measurement instruments, not code under test.
        "src/**/*.bench.ts",
        // Test-only doubles.
        "src/test-utils/**",
      ],
    },
  },
});
