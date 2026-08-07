# `src/heat-colours.ts`

## Purpose

Turning unbounded, multiplicative affordance scores into colours a human can
read — and stating the scale so the picture can be checked.

## Public API

- `heatScale(scores, threshold): HeatScale`
- `heatFraction(score, scale): number` — 0..1, logarithmic
- `heatColour(score, scale): Rgb`, `toHex(rgb): string`
- `describeScale(scale): string` — the strip's **title and screen-reader text**,
  not the numbers on screen. Those are `legend-model.ts`'s `minLabel`/`maxLabel`.
- `formatScore(value): string` — one score, as the legend prints it. Plain to two
  decimals below 1e4, exponential with a one-decimal mantissa above it, `"—"` for
  a non-finite value.

## Invariants & assumptions

- **`formatScore` is the single formatter, and the duplication it replaced was a
  live defect (DEC-R6b-6).** `legend-model.ts` carried its own `round`, so the
  sixth session's "von 1 bis 27992463056732.17" lived in a different file from
  `describeScale`. Abbreviating only here would have fixed the tooltip and left
  the reported number on screen unchanged. Do not reintroduce a second copy.
- **The switch is at 1e4, and it applies to the threshold as well as the max.**
  Both come off the same compounding scale — the score is a product of rule
  factors, measured at twelve orders of magnitude across one site — so
  abbreviating one field would leave the identical defect in the other. The
  accepted cost is that `12000` prints as `1.2e4`.

- **The ramp is LOGARITHMIC above the threshold, and that is the whole point.**
  The score is a product, so equal ratios must get equal colour steps. A linear
  ramp on a multiplicative quantity puts one outlier at the top and everything
  else at the bottom — the map would look empty whatever the data said, and the
  session would conclude "the scores are unusable" when what was unusable was
  the picture.
- **Cells at or below the threshold are off the ramp entirely.** "No rule said
  anything here" and "this scored badly" are different claims; colouring the
  first as the bottom of the ramp asserts knowledge the data does not have.
- **The scale is derived from the data on screen**, because the useful range
  differs by category and place — `walkable` in a city saturates where
  `restingArea` has a handful of cells at 6.
- **A degenerate scale collapses to flat, never to NaN.** A flat map is the
  correct picture of flat data; NaN is a black screen with no explanation.
- **Viridis-like, perceptually near-uniform, colour-blind safe.** A rainbow ramp
  invents banding that reads as structure in the data.
- **Rounding happens at the presentation boundary only** — the multiplicative
  kernel produces `3.6000000000000005`, and the oracle values must stay exact in
  the model.

## Examples

```ts
const scale = heatScale(scores, thresholdFor(table, "walkable"));
element.style.fill = toHex(heatColour(score, scale));
caption.textContent = describeScale(scale);
```

## Tests

`heat-colours.test.ts` — equal ratios giving equal steps, the threshold being
off-ramp, clamping, the degenerate collapse, monotonicity, valid hex, and the
scale description including the identity and the rounded max.
