import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

// Vitest scoping for the tour viewer. The Playwright e2e specs live in
// `playwright-tests/*.spec.js` and import `@playwright/test`, which throws if
// Vitest tries to collect them — restricting `include` to the colocated src
// unit tests keeps the two runners separated.
export default defineConfig({
  test: {
    // The shared fast-check time limit (every interruption is red), so a
    // failing property cannot shrink for hours where testTimeout cannot reach:
    // scripts/test-timing/fast-check-time-limit.mjs.md.
    setupFiles: [
      fileURLToPath(
        new URL('../scripts/test-timing/fast-check-time-limit.mjs', import.meta.url)
      ),
    ],
    include: ['src/**/*.test.ts'],
  },
});
