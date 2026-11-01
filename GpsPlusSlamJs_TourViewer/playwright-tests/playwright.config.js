// @ts-check
import { defineConfig, devices } from "@playwright/test";

import { browserLaunchArgs } from "../../scripts/e2e/browser-launch.mjs";
import { RESULTS_NAME, specsOf } from "./e2e-plan.js";

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
 * Chromium-only, matching the other demo apps. Two projects, `dom` and
 * `webgl`, from the plan in `e2e-plan.js`: the stage command
 * (`scripts/e2e/run-projects.mjs`) runs them one after the other, the DOM
 * specs at several workers and the WebGL specs at one. A direct
 * `playwright test` runs both projects together at `workers` below.
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
    ? [
        ["github"],
        // The runner gives each project its own file and merges them into
        // RESULTS_NAME, the one CI uploads.
        [
          "json",
          {
            outputFile: `../test-results/${process.env.E2E_RESULTS_NAME ?? RESULTS_NAME}`,
          },
        ],
      ]
    : [["list"], ["html", { open: "never" }]],
  use: {
    // A browser stage that run-stage lowered below normal priority (Windows)
    // renders in the browser process, which inherits that priority, instead
    // of a GPU process Chromium raises itself. See
    // scripts/e2e/browser-launch.mjs.md.
    launchOptions: { args: browserLaunchArgs(process.env) },
    baseURL: "http://127.0.0.1:5187",
    // A creator who already chose where the tour lives (polish round M2):
    // the page then opens at step 2, the link, which is where almost every
    // spec starts. The first-visit flow (step 1's host tiles) clears this
    // in its own tests.
    storageState: {
      cookies: [],
      origins: [
        {
          origin: "http://127.0.0.1:5187",
          localStorage: [{ name: "tour-viewer.wizard.host", value: "drive" }],
        },
      ],
    },
    trace: captureArtifacts ? "on" : "on-first-retry",
    screenshot: captureArtifacts ? "on" : "only-on-failure",
    video: captureArtifacts ? "on" : "retain-on-failure",
  },
  projects: [
    {
      name: "dom",
      testMatch: specsOf("dom").map((name) => `**/${name}`),
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "webgl",
      testMatch: specsOf("webgl").map((name) => `**/${name}`),
      use: { ...devices["Desktop Chrome"] },
    },
  ],
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
