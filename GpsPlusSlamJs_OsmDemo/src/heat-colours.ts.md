# `src/heat-colours.ts`

## Purpose

Turning unbounded, multiplicative affordance scores into colours a human can
read — and stating the scale so the picture can be checked.

## Public API

- `HEAT_CAP` — 1e4, the FIXED top of the ramp for every category and place.
- `fixedScale(threshold): HeatScale` — `{ threshold, max: HEAT_CAP }` for every
  threshold below the cap, which is every threshold that leaves a ramp.
  - **The one exception**: at `threshold >= HEAT_CAP` the ramp would be
    degenerate (span <= 0, so `heatFraction` returns 0 for every score and the
    whole grid paints the dark end with no message). There the max becomes
    `threshold * 10`. Still a pure function of a table constant, so the scale is
    fixed rather than data-derived — but in that band it is per-CATEGORY, which
    is the one property DEC-H5 otherwise removes.
  - **Takes the threshold, not the category.** The cap is category-independent
    (measured across all six), while the threshold already arrives per-category
    from `thresholdFor(table, category)`, so a `category` parameter would look
    nothing up. This is where a per-category cap would go if one were ever
    justified.
  - Replaces `heatScale(scores, threshold)`, which took the maximum score on
    screen.
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
- **The scale is FIXED, not derived from the data on screen** (DEC-H5). It used
  to be the maximum score present, which made a cell's colour depend on cells
  the user could not see: walk far enough for the hottest cell to leave the
  retained set and every remaining cell brightened with no change in its own
  data — **the picture reporting a change that did not happen**. AR is what
  promoted that from wart to defect, because the user walks continuously and the
  grid is what they are reading. It also made two observations incomparable:
  here versus a kilometre back, today versus last week.
  - **The objection this file used to carry is measured and does not hold.** It
    said a fixed scale "would make most categories look uniformly dark and hide
    precisely the variation being judged". The ramp is logarithmic, so at the
    weaker corpus site the five non-`walkable` categories' maxima land at 68 %,
    76 %, 91 %, 95 % and 107 % of a ramp running 1 → 1e4. See
    `category-score-distributions.test.ts`.
  - **The accepted cost:** `walkable` runs to 1e11 and 3e17 at the two corpus
    sites, so ~10–14 % of its coloured cells saturate. An outstanding spot stops
    being distinguishable from a merely very good one.
  - **The legend compensates**, and has to: `legend-model.ts` reports the
    observed maximum beside the fixed ramp, because otherwise a field where
    everything saturates reads identically to a flat field.
- **A degenerate scale collapses to flat, never to NaN.** A flat map is the
  correct picture of flat data; NaN is a black screen with no explanation.
- **Viridis-like, perceptually near-uniform, colour-blind safe.** A rainbow ramp
  invents banding that reads as structure in the data.
- **Rounding happens at the presentation boundary only** — the multiplicative
  kernel produces `3.6000000000000005`, and the oracle values must stay exact in
  the model.

## Examples

```ts
const scale = fixedScale(thresholdFor(table, "walkable"));
element.style.fill = toHex(heatColour(score, scale));
caption.textContent = describeScale(scale);
```

## Tests

`heat-colours.test.ts` — equal ratios giving equal steps, the threshold being
off-ramp, clamping, the degenerate collapse, monotonicity, valid hex, and the
scale description including the identity and the rounded max.
