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
    // The default 5 s timeout stands for this package. The one suite that
    // needed more asks for it itself — `cell-coverage.property.test.ts` — rather
    // than the ceiling being raised for every test here, which would make a
    // genuinely hung test cost 30 s instead of 5 s to discover.
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
