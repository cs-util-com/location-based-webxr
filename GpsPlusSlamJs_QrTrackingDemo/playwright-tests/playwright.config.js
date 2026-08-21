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
  // REFUSE TO RUN AGAINST A DEV SERVER OLDER THAN THE LAST LIBRARY BUILD.
  // `reuseExistingServer` below asks only whether the URL responds, and a server
  // that predates a rebuild of a linked workspace library still rewrites imports
  // to content-hashed files the rebuild renamed away — one 404, no boot, and every
  // spec that waits for the app times out looking exactly like a code defect.
  // That cost a session and a mislabelled commit on 2026-08-16.
  // See scripts/e2e/dev-server-freshness.mjs.md.
  globalSetup: "../../scripts/e2e/playwright-global-setup.mjs",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // ONE worker, locally as well as in CI (decided 2026-08-17, DEC-N8). Every
  // failure this suite has produced on a developer machine was a TIMEOUT, never
  // an assertion: three parallel workers each drive a full WebGL scene, so they
  // queue on one GPU instead of overlapping, and the queueing is what expires the
  // per-test budget. Measured on the same box that had been failing: serial, all
  // seven specs finished in 26.6 s, with one dropping 39.6 s -> 907 ms. Three
  // workers therefore buy latency and flakes, not throughput. The sibling
  // Landing and OsmDemo suites reached the same setting from their own
  // measurements — see their configs for the numbers.
  workers: 1,
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
