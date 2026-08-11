import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    // Pure-data package: no DOM, no jsdom. Anything that needs a browser API
    // (OPFS, Worker) lives in the consumer's bridge, not here — see the plan's
    // §4.2 dependency rules.
    environment: "node",
    // `scripts/**` is here for ONE reason and it is worth stating, because the
    // package is otherwise strictly `src`-only: `scripts/benchmark-matrix.mjs`
    // decides how hard this project hits donated public infrastructure, and a
    // politeness rule that is only a comment is not a rule. Its tests cannot
    // live in `src` — a `.test.ts` importing a `.mjs` would need `allowJs`, and
    // the script cannot be TypeScript because it must run under plain `node`
    // (the same constraint F23 records for `capture-fixtures.mjs`). So the tests
    // are `.test.mjs` next to the thing they test, and this line is what runs
    // them. Nothing else in `scripts/` is under test.
    include: ["src/**/*.test.ts", "src/**/*.spec.ts", "scripts/**/*.test.mjs"],
    silent: true,
    // RAISED FROM THE 5 s DEFAULT ON 2026-08-11, and the reasoning that used to
    // stand here — "the one suite that needs more asks for it itself, rather
    // than the ceiling being raised for every test, which would make a genuinely
    // hung test cost 30 s instead of 5 s to discover" — was sound and was
    // outlived by its evidence.
    //
    // WHAT CHANGED IS A MEASUREMENT. Across three consecutive gate runs while
    // another agent session loaded the machine, FIVE different files timed out
    // at 5 s and every one passed when re-run alone: `site-geometry` (2.4–3.6 s
    // idle), `site-water-index-cost` (1.1 s), `building-passages.property`, and
    // in the framework `occupancy-mesher.property` (1.2 s). A 1.1 s test blowing
    // a 5 s limit puts the cost of contention at **≥ 4.5×**, so the population
    // at risk is not "the heavy suites" — it is every test doing real work.
    // 22 property tests live in this package alone (37 more in the framework),
    // so per-suite opt-in cannot converge: each run tips a file the last one did
    // not, and the red gate that results is indistinguishable from a real one.
    // That is the actual cost being paid, and it is worse than the 25 extra
    // seconds a hang now takes to surface.
    //
    // **THIS IS A DEADLOCK GUARD, NOT A PERFORMANCE GATE, and the distinction is
    // what makes the raise safe.** A test that gets slower is caught by the
    // versioned `docs/test-timings.md`, which records per-stage medians and flags
    // a regression as 🔺 whatever this number says. Nothing about a 30 s ceiling
    // makes a 3 s test acceptable; it makes a 3 s test's PASS reliable.
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
