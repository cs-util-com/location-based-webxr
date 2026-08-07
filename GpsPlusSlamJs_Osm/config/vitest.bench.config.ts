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
  },
});
