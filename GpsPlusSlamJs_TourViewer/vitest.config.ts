import { defineConfig } from 'vitest/config';

// Vitest scoping for the tour viewer. The Playwright e2e specs live in
// `playwright-tests/*.spec.js` and import `@playwright/test`, which throws if
// Vitest tries to collect them — restricting `include` to the colocated src
// unit tests keeps the two runners separated.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
  },
});
