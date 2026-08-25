// @ts-check
import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright configuration for the tour viewer.
 *
 * Two web servers: the vite dev server (5187, allocated in
 * ../docs/dev-server-ports.md — the ONLY place that knows the whole set) and
 * the local archive server (5197) that serves a generated test zip twice —
 * once honoring Range (206 slices) and once ignoring it (200 full body) — so
 * the specs can prove real range streaming, the fallback, and the
 * second-visit cache hit without any cloud host involved.
 *
 * Chromium-only, matching the other demo apps.
 */
const captureArtifacts = process.env.PLAYWRIGHT_CAPTURE === "1";

export default defineConfig({
  testDir: ".",
  // REFUSE TO RUN AGAINST A DEV SERVER OLDER THAN THE LAST LIBRARY BUILD —
  // see scripts/e2e/dev-server-freshness.mjs.md.
  globalSetup: "../../scripts/e2e/playwright-global-setup.mjs",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : 3,
  reporter: process.env.CI
    ? [["github"], ["json", { outputFile: "../test-results/results.json" }]]
    : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:5187",
    trace: captureArtifacts ? "on" : "on-first-retry",
    screenshot: captureArtifacts ? "on" : "only-on-failure",
    video: captureArtifacts ? "on" : "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "pnpm run dev -- --port 5187",
      url: "http://127.0.0.1:5187",
      reuseExistingServer: !process.env.CI,
      timeout: 120000,
    },
    {
      command: "node archive-server.mjs 5197",
      url: "http://127.0.0.1:5197/health",
      reuseExistingServer: !process.env.CI,
      timeout: 30000,
    },
  ],
});
