# `playwright-tests/playwright.config.js` — landing e2e smoke config

## Purpose

Playwright config for the landing page's small e2e smoke suite
(`scroll-story.spec.js`). The story's logic is unit-tested; this suite
guards the runtime integration vitest cannot see — a headless smoke run
of exactly this shape caught two real visual defects during the initial
implementation (mid-flight compositions, phone body blocking its window),
which is why it was promoted from a throwaway script to a gate (user
decision, 2026-07-12).

## Key settings

- Chromium-only (matches the sibling apps); dev server on the landing's
  dedicated port **5182** via `webServer` (`pnpm run dev -- --port 5182`),
  reused locally, fresh in CI.
- CI: 2 retries, 1 worker, github + json reporters; local: list + html.
- `PLAYWRIGHT_CAPTURE=1` forces trace/screenshot/video capture.
- Chromium is launched with `browserLaunchArgs(process.env)` from `scripts/e2e/browser-launch.mjs`: `--in-process-gpu` when run-stage lowered the browser stage (Windows), so the WebGL work inherits the lowered priority; nothing otherwise.

## Invariants & assumptions

- Specs live next to this config (`testDir: "."`) as `*.spec.js` —
  vitest never collects them because its `include` is scoped to
  `src/**/*.test.ts`.
- `@playwright/test` is pinned to the same range as the sibling apps so
  CI's single browser install (RecorderApp step) serves all packages.
- Run via `pnpm run test:e2e` (never `npx playwright test` directly).

## Tests

Governs `scroll-story.spec.js`; part of `pnpm test` (after `test:core`).
