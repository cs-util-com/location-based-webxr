// @ts-check
import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for the OSM affordance demo.
 *
 * Chromium-only, on the demo's dedicated port 5186 so it coexists with the
 * minimal example (5180), the anchor starter (5181), the QR demo (5182) and the
 * recorder (5173).
 *
 * **This suite never touches the network.** Both external dependencies — the
 * Overpass API and the published Google Sheet — are intercepted in `fixtures.js`
 * and answered from checked-in data. That is not only about determinism: the
 * public Overpass instances are donated infrastructure with a shared budget of
 * roughly 2 slots per client, and a CI suite hammering them on every push would
 * be an abuse, not a flaky test.
 */
const captureArtifacts = process.env.PLAYWRIGHT_CAPTURE === '1';

export default defineConfig({
  testDir: '.',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : 3,
  reporter: process.env.CI
    ? [['github'], ['json', { outputFile: '../test-results/results.json' }]]
    : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:5186',
    trace: captureArtifacts ? 'on' : 'on-first-retry',
    screenshot: captureArtifacts ? 'on' : 'only-on-failure',
    video: captureArtifacts ? 'on' : 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // No `-- --port` passthrough, unlike the sibling demos: this package's
    // `dev` script builds its two workspace dependencies first, so pnpm
    // forwards a literal `--` into vite's argv and vite refuses it. The port
    // lives in vite.config.ts instead, which is the single place it belongs.
    command: 'pnpm run dev',
    url: 'http://127.0.0.1:5186',
    reuseExistingServer: !process.env.CI,
    // Generous because the first run builds gps-plus-slam-osm and the app
    // framework before vite even starts.
    timeout: 240000,
  },
});
