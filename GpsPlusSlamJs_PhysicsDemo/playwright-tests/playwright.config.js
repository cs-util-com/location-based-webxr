// @ts-check
import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright configuration for the physics demo.
 *
 * Scope (Tier 0): the page loads without console errors, the static mode-entry
 * UI renders, and the desktop-replay path is offered honestly in a browser that
 * lacks WebXR (Playwright Chromium has no `navigator.xr`) instead of crashing.
 *
 * Chromium-only because WebXR is Chrome-focused. The dev server runs on the
 * demo's dedicated port 5182 so it can coexist with the minimal example (5180),
 * the anchor starter (5181) and the recorder (5173).
 */
const captureArtifacts = process.env.PLAYWRIGHT_CAPTURE === "1";

export default defineConfig({
  testDir: ".",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : 3,
  reporter: process.env.CI
    ? [["github"], ["json", { outputFile: "../test-results/results.json" }]]
    : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:5182",
    trace: captureArtifacts ? "on" : "on-first-retry",
    screenshot: captureArtifacts ? "on" : "only-on-failure",
    video: captureArtifacts ? "on" : "retain-on-failure",
  },
  projects: [
    // Only test on Chromium since WebXR is Chrome-focused.
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: "pnpm run dev -- --port 5182",
    url: "http://127.0.0.1:5182",
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});
