# labs/globe/globe-perf-views.js - the recorder's fixed-view sweep with items

- Purpose: one link that tells whether the globe's full look holds the
  frame budget with a tour editor's items in it, on the device that runs
  it. The recorder (`globe-perf.js`) holds five views and a few item
  counts, repeated; this module is the sweep's pure part: the views, the
  plan, where the items stand, the refresh rate's snap and the pooled
  table. No DOM, no three, so it runs under `node --test`.
- Public API:
  - `PERF_VIEWS`: `space` (20,000 km over the ellipsoid), `100km`, `10km`,
    `1km` (over the drawn ground, pitched by the flight's law) and
    `street` (an eye height over the ground, placed by the lab).
  - `PERF_VIEWS_LIMITS`: at most 200 items, 6 counts; the spiral's 6 m.
  - `parsePerfItems(text)` -> ascending unique counts, or null for absent,
    empty or malformed text (a non-integer, over 200, more than 6 counts).
  - `perfViewCells({ items, repeats, views = PERF_VIEWS, warmup = true })`
    -> `{ repeat, view, items, warmup? }`:
    - with `warmup`, first one discarded cell per view (`repeat: 0`, the
      largest count, `warmup: true`): the first visit of a view loads its
      tiles and compiles its programs, which repeat 1 would otherwise pay
      alone;
    - then, per repeat and view, every count once, in an order rotated by
      `(repeat - 1 + view index)` (a Latin-square-like rotation): a fixed
      ascending order put the largest count last after every move, so a
      cost that grows with the time since the move (a cache release, a
      drain, a city fade) read as the items' cost;
    - `views` a subset (the recorder leaves `street` out without
      `eye=1`). RangeError for a repeat count that is not a positive
      integer or an empty view list.
  - `viewRunLabel(cell)` -> `"street n=50 r3"`, or `"space n=50 warm"`.
  - `perfViewsEstimateMs(cells, { holdMs, settleMs, calibrateMs = 0 })`:
    the calibration, one settle per move and one hold per cell (an
    estimate: the quiet waits and the items' warm-up are not in it).
  - `PERF_REFRESH_HZ`: 30, 60, 90, 120.
  - `snapRefreshInterval(ms)` -> `{ measuredMs, hz, intervalMs, mismatch }`:
    the nearest of those rates; `mismatch` when the measurement is more
    than 10 % off it (a throttled or variable-rate display: the drop
    count is then doubtful). Null for a value that is not finite and > 0.
  - `itemOffsets(n, spacingM = 6)` -> metres east and north on a sunflower
    spiral: even, the first near the centre, a prefix of any larger set;
    50 items within about 43 m. RangeError for a bad count or spacing.
  - `summariseViewRuns(runs)` -> one row per view and count:
    `{ view, items, runs, voided, timedOut, p50Ms, p95Ms, maxMs, workMs,
dropped, over33, over34, over50, over51, itemsWarmMaxMs }`. Warm-up
    runs are left out; voided runs (a touch, a hidden page, a lost
    context) and runs whose settle timed out (`extra.settledBefore ===
false`) are counted and kept out of every number. `workMs` is the
    median over runs of the frame callback's CPU time per frame; `p50Ms`
    and `p95Ms` the repeats' medians; the counts are summed.
  - `summariseViewDownloads(runs)` -> `[{ view, repeat, mib }]`, one per
    move: the bytes the page needed from the move to its last run.
  - `formatViewTable(rows, { refresh, downloads })` -> the overlay's text
    table (`view n p50 p95 max work drop >34 >51`, a row's voided and
    timed-out runs at its end), a legend, the display rate it was read
    against (or that it was not measured), and the MiB per move.
- Invariants & assumptions:
  - The counts come from the hash alone, so two devices given one link run
    the same plan; the views' order is fixed, the counts' order rotates.
  - `>34` and `>51` are kept beside `drop` on purpose: at 60 Hz, 34 ms
    is two refreshes, so `>34` counts frames that missed two or more
    vsyncs, and `drop` (from the snapped rate) every missed one. The
    export also keeps `over33` and `over50`; nothing reads them yet.
- Examples: `#at=46.948,7.4474&eye=1&perf=1&perfItems=0,5,20,50&perfAuto=1`.
- Tests: `globe-perf-views.test.mjs` (the plan, the rotation, the warm-up,
  the parse, the layout, the snap, the pooling, the downloads and the
  table); `globe-perf-views.smoke.spec.mjs` (the sweep in the page: it
  starts by itself, visits each view with the items, the street camera at
  eye height, item 0 in view and on the drawn ground, the export's rows).
