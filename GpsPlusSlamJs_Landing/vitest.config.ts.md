# `vitest.config.ts` — unit-test scoping

- **Purpose:** Restricts Vitest to the colocated `src/**/*.test.ts` unit
  tests (including `*.property.test.ts`).
- **Why it exists:** the Playwright e2e specs in
  `playwright-tests/*.spec.js` import `@playwright/test`, which throws if
  Vitest tries to collect them. Scoping `include` to `src` keeps the two
  runners separated: unit logic via Vitest (`pnpm run test:unit`),
  browser smoke via Playwright (`pnpm run test:e2e`).
- **Invariants:** all unit tests live under `src/` next to the code they
  cover; tests run in the default node environment — modules that touch
  browser APIs take them as injected seams instead of globals (see
  `src/theme.ts`, `src/scene/scene-controller.ts`).
- **Setup:** `setupFiles` lists the workspace's shared fast-check time
  limit (`../scripts/test-timing/fast-check-time-limit.mjs`, see its
  sidecar), so a failing property cannot shrink for hours;
  `src/fast-check-time-limit.test.ts` reads it in this package's run.
- **Tests:** governs every `*.test.ts` in `src/`.
