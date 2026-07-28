# `score/affordance-scorer.ts`

## Purpose

The multiplicative scoring kernel, ported from
`OsmHeatMapsManager.CalcHeatFor`. ~20 lines of arithmetic plus provenance.

## Public API

- `scoreFeature(feature, category, table, counters?): number`
- `scoreCells(index, table, options?): ScoreResult`
- `cellsAboveThreshold(result, category, threshold): string[]`
- `debugUrlForKey(featureKey): string`
- `CellScore`: `{ cell, scores, contributors }`
- `ScoreResult`: `{ cells, unmappedTagCounts, lookups }`

## The model

`heat(cell, category) = Π over features touching the cell ( Π over that
feature's tags ( ruleValue[tag][category] ) )`, identity `1` for unknown tags,
`0` absorbing.

## Invariants & assumptions

- **The tuned values are the valuable part, not this code.** The C# tests pin
  exact expected products — a beach cell at 5 × 7 = 35, the same with a historic
  way at 105 — which is what makes this port _verifiable_ rather than merely
  plausible, and why the model was kept over a bounded [0,1] redesign.
- **Category-agnostic.** The engine multiplies whatever the table declares under
  whatever names it declares. The game vocabulary is one possible table.
- **`0` short-circuits**, and the short-circuit is asserted by COUNTING lookups —
  "it returns 0" would pass with no short-circuit at all. On a building with 30
  tags this saves 29 lookups per cell per category, in the hot loop.
- **An unknown tag contributes exactly `1`.** Its failure mode is the worst
  available: if unknown meant `0`, every cell everywhere would score zero.
- **`contributors` is a plain `Record`, never a `Map`.** Scored chunks are cached
  through the string-valued blob store, and a `Map` JSON-serialises to `{}`
  silently — which reads as "this score has no explanation" rather than as a bug.
- **A feature contributing the identity is still recorded.** "This feature
  touched the cell and said nothing" is different information from "this feature
  was not here", and that difference is what makes a surprising score
  diagnosable.
- Provenance factors always multiply back to the total — asserted as a property.
  If they cannot reconstruct the score, they cannot explain it.
- `unmappedTagCounts` is counted **per feature, not per (feature, cell)**: a
  building covering 200 cells would otherwise report its `addr:city` two hundred
  times and drown the signal. It is off by default because it costs a map write
  per unmatched tag in the hot loop.
- Thresholding is **strictly above**, matching the reference. With the default
  threshold of `1`, a cell that merely scores the identity is unmapped ground,
  not a region.

## ⚠ The known flaw, carried over deliberately

**Scores are unbounded and not comparable across categories.** A cell overlapped
by five mapped features scores far higher than the identical physical surface
with one feature mapped — a data-**completeness** artefact, not a real signal.
There is a test asserting this (`dense > sparse * 100`) so the flaw stays visible
in the suite rather than only in a document.

Consumers must threshold **per category** and must never compare across
categories. A normalised view is the obvious follow-up.

## Examples

```ts
const result = scoreCells(index, table, { collectUnmapped: true });
const good = cellsAboveThreshold(
  result,
  "walkable",
  thresholdFor(table, "walkable"),
);
// Trace a surprising score:
Object.entries(cell.contributors["walkable"]).forEach(([key, factor]) =>
  console.log(factor, debugUrlForKey(key)),
);
```

## Tests

`affordance-scorer.test.ts` — the oracle values (35, 105, veto 0, identity 1),
the short-circuit proved by lookup counting, provenance including the
multiply-back invariant and the JSON boundary, category independence, unmapped
diagnostics, thresholding, and the unbounded-value flaw.

`affordance-scorer.property.test.ts` — order independence over features and over
tags, `0` absorbing, monotonicity, provenance reconstruction, unknown-tag
identity, and never producing NaN.
