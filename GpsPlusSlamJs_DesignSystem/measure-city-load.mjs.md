# measure-city-load.mjs - where a city load's seconds go, globe against OsmDemo

- Purpose: round-4 plan `2026-10-11-0122-globe-round-4-owner-feedback-plan.md`
  §5 item 4 (R4c step 1). The owner found the globe's city slower to load
  than OsmDemo's; this measures both apps at the same place and the same
  cache state, against the real network, so a fix aims at the real cost.
- Use: `pnpm run measure:city [lucerne|bern ...]` from
  `GpsPlusSlamJs_DesignSystem/` (OsmDemo's library deps built). Output: one
  markdown block per load on stdout and in `shots/city-load-measure.md`
  (gitignored).
- What it does, per place:
  - starts `serve.mjs` on the aux port (`DS_E2E_PORT`, 5198 by default) and
    OsmDemo's vite dev server on the aux port plus one, both on 127.0.0.1;
  - for each app, a COLD load (a fresh browser context: an empty OPFS store
    and HTTP cache), then a WARM one (the same context, a new page);
  - the globe: `labs/globe/#at=<place>&view=<3 km up>&relief=1` (the link's
    warm-up starts at load); it reads `__globeLab.state()` every 250 ms for
    the warm-up's end and counts and the city's phase;
  - OsmDemo: `/?lat=&lng=`; it reads the status line for the first cells,
    the first city (`N volumes`) and the last ring (no `widening`), and the
    page's own per-ring breakdown (`click ring ...`, `console.info`);
  - for both, every Overpass and height-tile request (`context.on`, so a
    worker's requests count too) with its start and end, and the main
    thread's long tasks (PerformanceObserver).
- Invariants & assumptions:
  - The order of the apps alternates per place, so an Overpass server's own
    cache never favours the same app twice.
  - Not a gate, never in CI: it reaches donated Overpass infrastructure (a
    few res-7 tiles per run, as a user's own visit would) and headless
    Chromium draws on the CPU (SwiftShader), so its seconds are the
    network's and the parse's; a long task count compares within one load,
    never alone. Page errors are listed under "Problems".
- Teardown: the demo server is ended with its whole process tree
  (`stopTree`: on Windows pnpm, cmd and vite run as a chain and a plain
  `kill` left vite alive, holding the browser slot for 40 minutes), and the
  script exits once its report is written.
- Tests: none of its own (an eyeball tool, like `measure-globe.mjs`). The
  fields it reads are the smokes' (`globe-city.smoke.spec.mjs`,
  `globe-arrival.smoke.spec.mjs`; OsmDemo's `fixtures.js` `waitForRefresh`).
