// @ts-check
import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright configuration for the wayfinding-HUD demo.
 *
 * Scope: the desktop walk simulator needs no WebXR, so unlike the sibling
 * apps these e2e tests drive the REAL wayfinding HUD (real three.js camera,
 * real placement math) — smoke coverage plus a keyboard-driven walk flow
 * asserting the hysteresis state machine through the DOM status line.
 *
 * Chromium-only because WebXR is Chrome-focused. The dev server runs on the
 * demo's dedicated port 5183 so it can coexist with the minimal example
 * (5180), the anchor starter (5181), the physics demo (5182) and the
 * recorder (5173).
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
    baseURL: "http://127.0.0.1:5183",
    trace: captureArtifacts ? "on" : "on-first-retry",
    screenshot: captureArtifacts ? "on" : "only-on-failure",
    video: captureArtifacts ? "on" : "retain-on-failure",
  },
  projects: [
    // Only test on Chromium since WebXR is Chrome-focused.
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: "pnpm run dev -- --port 5183",
    url: "http://127.0.0.1:5183",
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});
