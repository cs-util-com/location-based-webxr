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
    - the warm-up loads each view's tiles and compiles the scene's own
      programs, not the items': a count of 0 disposes the items'
      materials, so each count's first frames compile them again, which
      its `itemsWarm` records apart;
    - then, per repeat and view, every count once, starting at a count
      rotated by `(repeat - 1 + view index)`: a fixed ascending order put
      the largest count last after every move, so a cost that grows with
      the time since the move (a cache release, a drain, a city fade) read
      as the items' cost. Odd repeats go forward through the counts, even
      repeats backward: forward only, each count always followed the same
      one (0 followed 50 and paid its disposal);
    - `views` a subset (the recorder leaves `street` out without
      `eye=1`). RangeError for a repeat count that is not a positive
      integer, an empty view list or no counts.
  - `viewRunLabel(cell)` -> `"street n=50 r3"`, or `"space n=50 warm"`.
  - `perfViewsEstimateMs(cells, { holdMs, settleMs, calibrateMs = 0 })`:
    the calibration, one settle per move and one hold per cell. An
    estimate, not a bound: the quiet waits, a city waited for and slow
    frames are not in it, so the overlay labels it as one.
  - `perfViewsPlanText({ items, runs, estimateMs, cityWaitS,
streetSkipped })` -> the overlay's plan line: the counts, the runs,
    the estimate's whole minutes "(an estimate)", then, when the sweep
    waits for the city (`cityWaitS` > 0, the lab's `perfCityWaitS`),
    "plus up to N min waiting for the city" (the estimate leaves it out),
    that street level was left out, and not to touch the screen.
  - `missedThresholdsMs(intervalMs)` -> the thresholds (ms) for frames
    that missed at least 1, 2 and 3 refreshes: 1.5, 2.5 and 3.5
    intervals, halfway between the multiples a frame lands on (60 Hz:
    25, 41.7, 58.3), rounded to 0.1 ms; null without a usable interval.
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
dropped, over33, over50, missed1, missed2, missed3, itemsWarmMaxMs }`
    (`missedN` over each run's `missedMs`, null when a run has none). Warm-up
    runs are left out; voided runs (a touch, a hidden page, a lost
    context) and runs whose settle timed out (`extra.settledBefore ===
false`) are counted and kept out of every number. `workMs` is the
    median over runs of the frame callback's CPU time per frame; `p50Ms`
    and `p95Ms` the repeats' medians; the counts are summed.
  - `summariseViewDownloads(runs)` -> `[{ view, repeat, mib }]`, one per
    move: the bytes the page needed from the move to its last run.
  - `formatViewTable(rows, { refresh, downloads })` -> the overlay's text
    table (`view n p50 p95 max work drop >=1 >=2 >=3`, a row's voided and
    timed-out runs at its end), a legend, the display rate it was read
    against with the missed thresholds (or that it was not measured),
    and the MiB per move.
- Invariants & assumptions:
  - The counts come from the hash alone, so two devices given one link run
    the same plan; the views' order is fixed, the counts' order rotates.
  - The missed counts replace fixed 34 and 51 ms counters, which sat
    right on 60 Hz's refresh multiples (jitter moved frames across them)
    and meant another number of refreshes at 30, 90 or 120 Hz. `drop`
    (refreshes missed in all, from the snapped rate) stays beside them;
    the export also keeps `over33` and `over50`, the plan's verdict.
- Examples: `#at=46.948,7.4474&eye=1&perf=1&perfItems=0,5,20,50&perfAuto=1`.
- Tests: `globe-perf-views.test.mjs` (the plan, the rotation and the
  even repeats' reversal, the missed thresholds, the warm-up,
  the parse, the layout, the snap, the pooling, the downloads, the
  table and the plan line); `globe-perf-views.smoke.spec.mjs` (the sweep in the page: it
  starts by itself, visits each view with the items, the street camera at
  eye height, item 0 in view and on the drawn ground, the export's rows).
