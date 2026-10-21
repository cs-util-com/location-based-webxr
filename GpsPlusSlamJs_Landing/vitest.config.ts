import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

// Vitest scoping for the landing page. Unit tests live under `src/` and
// `scripts/` (the blog/marketing suites); the Playwright e2e specs live in
// `playwright-tests/*.spec.js` and must never be collected by Vitest (they
// import @playwright/test, which throws under a foreign runner) — both globs
// exclude `playwright-tests/`, which keeps the two runners separated,
// mirroring the sibling apps. Unit tests run in the
// default node environment — modules that touch browser APIs (matchMedia,
// localStorage, scroll metrics) take them as injected seams instead of
// globals, which keeps the suite fast and deterministic.
export default defineConfig({
  test: {
    // The shared fast-check time limit (every interruption is red), so a
    // failing property cannot shrink for hours where testTimeout cannot reach:
    // scripts/test-timing/fast-check-time-limit.mjs.md.
    setupFiles: [
      fileURLToPath(
        new URL("../scripts/test-timing/fast-check-time-limit.mjs", import.meta.url)
      ),
    ],
    include: ["src/**/*.test.ts", "scripts/**/*.test.mjs"],
  },
});
