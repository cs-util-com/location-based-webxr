// @ts-check
import { defineConfig, devices } from "@playwright/test";

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
const captureArtifacts = process.env.PLAYWRIGHT_CAPTURE === "1";

export default defineConfig({
  testDir: ".",
  // 90 s, not Playwright's 30 s default, and the default was INCOHERENT with this
  // suite's own waits: `waitForRefresh` allows the pipeline 60 s to finish, which
  // it could never use, because the test was killed at 30 s first. The boot chain
  // is long by design — the rule-table loader degrades live -> cache -> snapshot
  // (the fixture aborts the live fetch on purpose), then a full fetch, score and
  // mesh build runs before the first assertion.
  //
  // This is a machine-speed guard, not slack for slow code. Three browsers run in
  // parallel here, and on a loaded developer machine every stage of the gate was
  // measured at 3-4x its own recorded median — at which point a 30 s budget is
  // measuring the machine. It cost two or three failures per run, a different two
  // or three each time, with every one of them passing standalone.
  timeout: 90_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // THREE, ON AN EIGHT-CORE MACHINE, AND THE HEADROOM IS AN ILLUSION. Raising this
  // to 5 was measured: no wall-clock gain (4.8 min against a 4.6 min mean) and two
  // grid tests failed that pass at 3.
  //
  // Each worker is a headless Chromium doing software-rasterised WebGL, which
  // saturates the machine long before the worker count reaches the core count. The
  // demo reports its own terrain cost, and the same boot on the same fixture reads
  // `ground cpu 77.2 ms` at --workers=1 and `ground cpu 1659.6 ms` under 3-5 — a 21x
  // inflation of identical work. That is also why the timeout above is 90 s.
  //
  // So the suite is CONTENTION-bound, not work-bound: more workers buy queueing, not
  // throughput, and the only lever left is removing work. Full findings in
  // GpsPlusSlamJs_Docs/docs/2026-08-02-0455-osm-demo-e2e-suite-speed-findings.md.
  workers: process.env.CI ? 1 : 3,
  reporter: process.env.CI
    ? [["github"], ["json", { outputFile: "../test-results/results.json" }]]
    : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:5186",
    trace: captureArtifacts ? "on" : "on-first-retry",
    screenshot: captureArtifacts ? "on" : "only-on-failure",
    video: captureArtifacts ? "on" : "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // No `-- --port` passthrough, unlike the sibling demos: this package's
    // `dev` script builds its two workspace dependencies first, so pnpm
    // forwards a literal `--` into vite's argv and vite refuses it. The port
    // lives in vite.config.ts instead, which is the single place it belongs.
    command: "pnpm run dev",
    url: "http://127.0.0.1:5186",
    reuseExistingServer: !process.env.CI,
    // Generous because the first run builds gps-plus-slam-osm and the app
    // framework before vite even starts.
    timeout: 240000,
  },
});
