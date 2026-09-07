import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Scoped to src/ deliberately. Vitest's default include matches
    // `**/*.spec.{ts,js}`, which sweeps up the Playwright specs in
    // `playwright-tests/` — they then fail on `@playwright/test`'s import,
    // which is a confusing way to learn that two runners share a filename
    // convention. The e2e suite has its own runner and its own gate stage.
    include: ['src/**/*.test.ts'],
  },
});
