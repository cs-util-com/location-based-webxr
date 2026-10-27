# labs/globe/globe-perf-views.js - the recorder's fixed-view sweep with items

- Purpose: one link that tells whether the globe's full look holds the
  frame budget with a tour editor's items in it, on the device that runs
  it. The recorder (`globe-perf.js`) holds five views and a few item
  counts, repeated; this module is the sweep's pure part: the views, the
  plan, where the items stand, and the pooled table. No DOM, no three, so
  it runs under `node --test`.
- Public API:
  - `PERF_VIEWS`: `space` (20,000 km over the ellipsoid), `100km`, `10km`,
    `1km` (over the drawn ground, pitched by the flight's law) and
    `street` (an eye height over the ground, placed by the lab).
  - `PERF_VIEWS_LIMITS`: at most 200 items, 6 counts; the spiral's 6 m.
  - `parsePerfItems(text)` -> ascending unique counts, or null for absent,
    empty or malformed text (a non-integer, over 200, more than 6 counts).
  - `perfViewCells({ items, repeats })` -> `{ repeat, view, items }` in
    order repeat, view, count (one camera move per view and repeat).
    RangeError for a repeat count that is not a positive integer.
  - `viewRunLabel(cell)` -> `"street n=50 r3"`.
  - `perfViewsEstimateMs(cells, { holdMs, settleMs })`: an upper bound.
  - `itemOffsets(n, spacingM = 6)` -> metres east and north on a sunflower
    spiral: even, the first near the centre, a prefix of any larger set;
    50 items within about 43 m. RangeError for a bad count or spacing.
  - `summariseViewRuns(runs)` -> one row per view and count: runs, voided,
    the repeats' median p50 and p95, the worst frame, frames over 33 and
    50 ms summed, the most MiB needed. Voided runs are counted, not pooled.
  - `formatViewTable(rows)` -> the overlay's text table.
- Invariants & assumptions: the counts come from the hash alone, so two
  devices given one link run the same plan; the views' order is fixed.
- Examples: `#at=46.948,7.4474&eye=1&perf=1&perfItems=5,20,50&perfAuto=1`.
- Tests: `globe-perf-views.test.mjs` (the plan, the parse, the layout, the
  pooling and the table); `globe-perf-views.smoke.spec.mjs` (the sweep in
  the page: it starts by itself, visits each view with the items, the
  street camera at eye height, the export's rows).
