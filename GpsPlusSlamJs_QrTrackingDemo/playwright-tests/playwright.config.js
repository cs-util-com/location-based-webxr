// @ts-check
import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright configuration for the QR-tracking demo.
 *
 * Chromium-only (WebXR is Chrome-focused). The dev server runs on the demo's
 * The port is allocated in docs/dev-server-ports.md, which is the ONLY place
 * that knows the whole set — three packages once shared 5182 while all three
 * comments named their siblings and asserted distinctness.
 *
 * Real WebXR / camera / depth are
 * absent in desktop Chromium, so the suite drives the app through the faked
 * device seam (`window.__qrDemoSeams`) — see `fakes.js`.
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
    baseURL: "http://127.0.0.1:5185",
    trace: captureArtifacts ? "on" : "on-first-retry",
    screenshot: captureArtifacts ? "on" : "only-on-failure",
    video: captureArtifacts ? "on" : "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm run dev -- --port 5185",
    url: "http://127.0.0.1:5185",
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});
