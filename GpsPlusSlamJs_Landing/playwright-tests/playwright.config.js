// @ts-check
import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright configuration for the landing page's e2e smoke suite.
 *
 * Scope (deliberately small — the story's logic is unit-tested; this
 * suite guards the runtime integration vitest cannot see):
 * - The page boots and every chapter section activates while scrolling,
 *   with zero console errors / page errors.
 * - The WebGL canvas renders (or the static-DOM floor engages cleanly).
 * - The theme toggle flips and persists across reload.
 * - The five demo links stay present.
 * - Reduced-motion still presents every chapter readable.
 *
 * Chromium-only, matching the sibling apps. The dev server runs on the
 * landing's dedicated port 5182 so it can coexist with the minimal
 * example (5180), the starter (5181) and the recorder (5173).
 */
const captureArtifacts = process.env.PLAYWRIGHT_CAPTURE === "1";

export default defineConfig({
  testDir: ".",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 1,
  // ONE worker everywhere: every spec drives a full WebGL scene, and
  // several parallel GL contexts under an already-loaded GPU lose their
  // contexts (observed locally: CONTEXT_LOST_WEBGL + SharedImage
  // failures with 3 workers while the recorder suite ran elsewhere).
  workers: 1,
  reporter: process.env.CI
    ? [["github"], ["json", { outputFile: "../test-results/results.json" }]]
    : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:5182",
    trace: captureArtifacts ? "on" : "on-first-retry",
    screenshot: captureArtifacts ? "on" : "only-on-failure",
    video: captureArtifacts ? "on" : "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm run dev -- --port 5182",
    url: "http://127.0.0.1:5182",
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});
