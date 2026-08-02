// @ts-check
import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright configuration for the OSM affordance demo.
 *
 * Chromium-only.
 *
 * The port is allocated in docs/dev-server-ports.md, which is the ONLY place
 * that knows the whole set — three packages once shared 5182 while all three
 * comments named their siblings and asserted distinctness.
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
  //
  // RAISED 90 s -> 120 s BY §2, and the reason is worth recording because it
  // reads like slack for slow code and is not. The slope treatment (DEC-R6-5)
  // adds per-fragment work — `fwidth`, an aspect tint and a rim term — to the
  // DEFAULT ground, which is a 4.8 km plane with heavy overdraw at grazing
  // angles. Measured effect on this suite: **5.5 min -> 8.3 min**, and two tests
  // that pass standalone in ~50-60 s began timing out under contention.
  //
  // **That number mostly measures the wrong machine.** Headless Chromium here
  // rasterises on the CPU (SwiftShader), where extra per-fragment maths is far
  // more expensive than on the GPU this demo actually runs on. The instrument
  // that matters is the perf overlay's frame-ms readout on a real device, which
  // is F39 and is still not taken — so the honest position is that the e2e cost
  // is real, is measured, and is an upper bound rather than the answer.
  timeout: 120_000,
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
