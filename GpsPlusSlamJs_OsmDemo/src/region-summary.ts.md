# `src/region-summary.ts`

## Purpose

Turns a selected affordance region into the text the details panel shows
(DEC-R7b-3a). Pure: no DOM, no three.js, no store.

## Public API

- `SummarisableRegion` — `{ id, category, cellCount, areaM2, medianScore,
minScore, maxScore }`. Structural rather than the package's `Region`, so a test
  can build one in a literal and this module does not depend on the region
  builder.
- `RegionSummary["stats"][number]` — `{ label, value }`, both already formatted
  for display. The interface is **not exported**: it is reachable through
  `RegionSummary`, and knip is right that a second public name earns nothing.
- `RegionSummary` — `{ title, stats, spreadNote }`.
- `summariseRegion(region) → RegionSummary`. Total; never throws.

## Invariants & assumptions

- **Scores go through `formatScore`**, the legend's helper. Round 7 shipped a
  legend reading `1 … 27992463056732.17` because a second copy of the rounding
  existed in another file; a third copy here would be the same defect again.
- **The `spreadNote` fires only at a 10× gap** between median and maximum. The
  scores are a PRODUCT of rule factors and span twelve orders of magnitude at
  Cologne, so a 2× spread inside one region is unremarkable — a note on every
  region would be the same as no note.
- **The median stays the paint value.** `region-builder.ts` argues at length for
  the median over the mean (one heavily-mapped cell drags a mean), and this
  module does not reopen that. The fix for the session's finding is to stop the
  median being the _only_ thing shown.
- **Area is scaled to a unit a human reads** — m², then ha past 10 000, then km²
  past 1 000 000.
- **Non-finite scores render as `—`**, not `Infinity`. the pipeline filters them
  upstream, but a panel reading "Infinity" looks like a broken demo rather than
  broken input.

## What it deliberately does NOT do

Show _where inside the region_ the peaks are. That needs per-cell scores on the
3D side, and `SlabRegion` carries only `{ outline, medianScore, id }` — a new
data path rather than a new shader. Deferred by DEC-R7b-11; the note points the
reader at the cells layer instead.

## Tests

`region-summary.test.ts` — the session's own numbers (median 10, peak 288), the
quiet case, the huge-score case, `1 cell` vs `1 cells`, the three area units, and
a non-finite guard.
