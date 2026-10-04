# labs/globe/globe-perf-stats.js - the seam to the framework's frame statistics

- Purpose: globe zoom frame-hitch plan 2026-10-03-2017 (PERF-0, PERF-1;
  DEC-H3: one implementation). The lab's recorder takes its whole-run
  histogram, attribution join, idle calibration, target check, on-screen
  summary and export from the framework (`/fw/utils/frame-run.js`,
  `frame-run-report.js`, `frame-target.js`), through this one file.
- Public API (re-exported unchanged): `createFrameRun`,
  `calibrateRefreshInterval`, `buildFrameExport`, `formatFrameRunSummary`,
  `checkFrameTarget`. Their contracts are in the framework's sidecars.
- Invariants & assumptions: loaded only through `globe-perf.js`, so only
  with `#perf=1`; the page's boot graph never reaches the framework's
  frame modules.
- Tests: none of its own (a re-export); the framework's unit tests cover
  the functions and `globe-perf.smoke.spec.mjs` covers the wiring.
