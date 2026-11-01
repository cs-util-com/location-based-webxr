import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

// No alias: a dependency resolves through its package `exports` (a built
// `dist` where it has one), exactly as a Vite app bundling the kit does.
export default defineConfig({
  test: {
    // The shared fast-check time limit (every interruption is red), so a
    // failing property cannot shrink for hours where testTimeout cannot reach:
    // scripts/test-timing/fast-check-time-limit.mjs.md.
    setupFiles: [
      fileURLToPath(
        new URL(
          "../../scripts/test-timing/fast-check-time-limit.mjs",
          import.meta.url,
        ),
      ),
    ],
    globals: true,
    // Node by default; a DOM block's test opts into jsdom with a
    // `// @vitest-environment jsdom` first line. The blocks' browser check
    // is the Tour Viewer's e2e (the served-by edge in
    // scripts/test-changed/select.mjs).
    environment: "node",
    include: ["src/**/*.test.ts"],
    silent: true,
    // A deadlock guard, not a performance gate.
    testTimeout: 30_000,
  },
});
