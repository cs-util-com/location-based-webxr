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
  // REFUSE TO RUN AGAINST A DEV SERVER OLDER THAN THE LAST LIBRARY BUILD.
  // `reuseExistingServer` below asks only whether the URL responds, and a server
  // that predates a rebuild of a linked workspace library still rewrites imports
  // to content-hashed files the rebuild renamed away — one 404, no boot, and every
  // spec that waits for the app times out looking exactly like a code defect.
  // That cost a session and a mislabelled commit on 2026-08-16.
  // See scripts/e2e/dev-server-freshness.mjs.md.
  globalSetup: "../../scripts/e2e/playwright-global-setup.mjs",
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
  // RAISED 120 s -> 180 s ON 2026-08-03, on an owner decision, and the reason to
  // record it is that this is the SECOND raise and it is treating a symptom.
  //
  // Measured across five full gate runs in one day, same machine, same commit
  // range: three were RED, a different victim each time, every one green
  // standalone. Wall-clock swung 7.6 -> 9.9 -> 11.5 -> 8.4 min. Two distinct
  // failure modes appeared:
  //
  // - The known widening race (F42) — an assertion comparing a stashed frame
  //   against a later one while the scored working set is still filling rings.
  //   A longer budget does not fix this; it only gives the widening more time
  //   to finish, which happens to make it pass more often.
  // - **`Tearing down "context" exceeded the test timeout`** — new, and NOT an
  //   assertion. Three tests hit it in one run. A teardown that outruns the
  //   budget points at WebGL context cleanup under contention rather than at
  //   anything the app asserts.
  //
  // **What this raise buys and what it hides.** It buys a gate that goes green
  // often enough to be usable while §4's model rebuild lands, which is why it
  // was taken. It hides the trend: the budget went 90 -> 120 in §2 and now
  // 120 -> 180, while the honest instrument — F39's frame-ms readout on a real
  // device — has still never been taken. **If a third raise is ever proposed,
  // that is the signal to fix the suite instead.**
  timeout: 180_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // ONE, EVERYWHERE — and the parallel version is not slower, it is just noisier.
  //
  // Each worker is a headless Chromium doing software-rasterised WebGL, which
  // saturates the machine long before the worker count reaches the core count. The
  // demo reports its own terrain cost, and the same boot on the same fixture reads
  // `ground cpu 77.2 ms` at --workers=1 and `ground cpu 1659.6 ms` under 3-5 — a 21x
  // inflation of identical work. That is also why the timeout above is 180 s.
  //
  // So the suite is CONTENTION-bound, not work-bound: more workers buy queueing, not
  // throughput. That was measured on 2026-08-02 (66 tests) when 3 workers still
  // bought 34% — 426 s serial against a ~280 s mean — and it has since crossed all
  // the way over. Re-measured 2026-08-07 on the current 45-test suite:
  //
  //   --workers=1:  547, 549 s          (spread 2 s)
  //   --workers=3:  499, 504, 517, 543, 574, 582 s   (spread 83 s)
  //
  // The means differ by ~2%, which is inside the noise of the parallel runs alone.
  // So three workers buy nothing measurable and pay for it with a 40x wider spread
  // and with contention flakes: the OPFS-cache quiescence flake fixed on
  // 2026-08-07 only ever reproduced under full-suite parallel load, exactly as its
  // own comment predicted. Serial is the same wall clock, reproducible, and it
  // makes a red run mean something.
  //
  // Do NOT read this as "parallelism is bad here forever" — it is a statement
  // about a suite whose every test boots a WebGL scene. Removing that work (see
  // the findings docs) would make workers worth having again.
  //
  // Full findings: GpsPlusSlamJs_Docs/docs/2026-08-02-0455-osm-demo-e2e-suite-speed-findings.md
  // and 2026-08-07-simplify-loop-findings.md (Area 1).
  workers: 1,
  reporter: process.env.CI
    ? [["github"], ["json", { outputFile: "../test-results/results.json" }]]
    : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:5186",
    trace: captureArtifacts ? "on" : "on-first-retry",
    screenshot: captureArtifacts ? "on" : "only-on-failure",
    // `retain-on-failure`, KEPT AFTER MEASURING THE ALTERNATIVE AND REJECTING IT.
    //
    // A findings doc measured `video` at ~29 % of the e2e stage on a SEVEN-test
    // suite and recommended `on-first-retry`, matching `trace` -- explicitly
    // "measure it before adopting it across all seven" packages. Measured here:
    //
    //   retain-on-failure   861.7 s median
    //   on-first-retry      899.5 s  (one run, flagged as within noise)
    //
    // NO SAVING. The 29 % does not generalise. That suite's tests are short, so
    // per-test encode is a large share of them; here each of 72 tests boots a
    // WebGL scene, and at `workers: 1` the encode overlaps the next test's
    // setup rather than adding wall clock.
    //
    // AND THE COST WOULD HAVE BEEN REAL. `retries` is 0 locally, so
    // `on-first-retry` records NOTHING on a local failure -- and since `trace`
    // is already `on-first-retry`, the video is the ONLY local failure artefact
    // there is. The trade was: lose the last thing you can look at when a test
    // fails on this machine, in exchange for nothing measurable.
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
