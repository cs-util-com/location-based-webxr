// @ts-check
import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright configuration for the persistent-anchor starter example.
 *
 * Scope (Tier 0, see GpsPlusSlamJs_Docs/docs/2026-06-01-0447-anchor-starter-e2e-test-plan.md):
 * - The page loads without console errors.
 * - The static start/intro UI renders.
 * - The E1 capability gate fires honestly in a desktop browser that lacks
 *   WebXR (Playwright Chromium has no `navigator.xr`), instead of crashing.
 *
 * Chromium-only because WebXR is Chrome-focused. The dev server runs on the
 * The port is allocated in docs/dev-server-ports.md, which is the ONLY place
 * that knows the whole set — three packages once shared 5182 while all three
 * comments named their siblings and asserted distinctness.
 *
 * Clipboard permissions are granted up front
 * so the Tier 1 copy-link tests (a later plan tier) can read/write the
 * clipboard without re-prompting.
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
    baseURL: "http://127.0.0.1:5181",
    trace: captureArtifacts ? "on" : "on-first-retry",
    screenshot: captureArtifacts ? "on" : "only-on-failure",
    video: captureArtifacts ? "on" : "retain-on-failure",
    permissions: ["clipboard-read", "clipboard-write"],
  },
  projects: [
    // Only test on Chromium since WebXR is Chrome-focused.
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: "pnpm run dev -- --port 5181",
    url: "http://127.0.0.1:5181",
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});
