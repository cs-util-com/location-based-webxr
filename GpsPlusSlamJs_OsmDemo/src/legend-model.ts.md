# `legend-model.ts`

**Purpose.** Decide what the legend says — the ramp swatches, the end labels, the three sub-threshold bands — as pure data, so the decisions can be tested without a browser.

## Public API

- `legendModel(scale, category, showBelowThreshold, data): LegendModel`
  - `data` is `{ aboveThresholdCount, observedMax }` from the snapshot, and it
    is **required** rather than optional (DEC-H7). An optional argument would
    let a caller silently stop supplying it and get the pre-fix behaviour back —
    which is a legend that cannot say "nothing here".
- `LegendModel` — `{ category, ramp, minLabel, maxLabel, observedLabel,
aboveThresholdCount, bands, description, emptyMessage? }`.
  - `ramp` — `RAMP_STOPS` (7) swatches sampled **through `heatColour`**, geometrically spaced from `threshold` to `max`.
  - `description` — `describeScale(scale)` verbatim, for the strip's `title` / `aria-label`.
  - `bands` — empty unless `showBelowThreshold`; otherwise exactly three, in order `veto`, `identity`, `below`.
- `LegendStop` — `{ kind, colour, fill, label }`. `fill: false` means "draw the outline, leave the middle empty".
- `LegendStopKind` — `"ramp" | "veto" | "identity" | "below"`.
- `classifyScore(score, threshold): LegendStopKind` — which band a cell belongs to. **Total** over every finite score, and non-finite scores land in `identity`: the map asks this for every cell it draws, so a score with no band would be a cell with no fill, an invisible hole rather than a visible error.
- `VETO_COLOUR`, `IDENTITY_COLOUR`, `BELOW_THRESHOLD_COLOUR` — consumed by `map-view.ts` so the map paints exactly the bands the legend describes. One source, or the legend becomes an active lie.

## Invariants & assumptions

- **The ramp is sampled through `heatColour`, never re-derived from the palette.** A legend that interpolated its own copy of the ramp would drift from what the map paints, which is the one failure mode a legend cannot have.
- **The category name is part of the model.** The reported symptom was "switching category did not reset the map": the map does redraw, but every category scores nearly every rule, so the same hexagons return in similar colours whichever one is selected. A picture that does not say what it is a picture _of_ cannot be checked by eye.
  - This used to give the reason as "`heatScale` re-normalises to each category's own maximum". DEC-H5 deleted that mechanism and **the reason outlives it**: what makes the picture ambiguous is the OVERLAP between categories, which a fixed ramp does nothing about. The same sentence was corrected in `legend-model.ts` and `map-and-cells.spec.js`; this copy — the one a reader is pointed at first — was missed until the r513 review.
- **The identity band is outline-only (`fill: false`).** "No rule said anything here" must not paint a claim the data does not support — the assertion `map-view.ts` has always made in a comment, now made in pixels.
  - **A geo-event marker can land on one of these, and it is not a contradiction.** The legend describes each cell BY ITS OWN SCORE; the geo-event's hill climb ranks by the sum over a cell and its neighbours, so it can settle on an identity cell that happens to be enclosed by strong ones. Reported once as a suspected bug. Nothing in the legend can express the neighbourhood metric, which is exactly why the picture cannot be used to check the marker — see `geo-event.ts.md`.
- **`0` is not the bottom of the ramp.** `VETO_COLOUR` is deliberately outside the viridis palette: a hard veto is a categorical statement ("never here"), not a low score, and colouring it as the ramp's dark end would put it on the same axis as a merely-weak cell. Telling those two apart is the entire point of DEC-7.
- **Total over every scale the sheet can produce.** Thresholds come from a publicly editable Google Sheet via `toNumber`, which accepts `0` and negatives — and `heatFraction` has a documented `#NaNNaNNaN` scar from exactly that. A property test asserts no colour is ever malformed and no label ever contains `NaN` or `Infinity`, for hostile scales including `threshold = 0` and `max < threshold`.
- **"Nothing scores above the bar" is a COUNT, not a degenerate scale**
  (DEC-H7). It used to be `scale.max <= scale.threshold`, which worked only
  because the max was observed — `heatScale` collapsed it onto the threshold
  when nothing qualified. Under the fixed ramp `max > threshold` always, so that
  test can never fire again: the R3-8 fix would have died silently and its e2e
  would have stayed green. The count is threaded in from the snapshot, and it is
  what the condition always meant.
- **`observedLabel` sits BESIDE the ramp, not on it.** Once the ramp stopped
  being derived, every number in this model became a constant — and a legend
  that reports nothing about the data on screen is against `describeScale`'s
  stated purpose. It is also the only way to tell "everything here saturates"
  from "everything here is flat", which look identical on a clipped ramp.
- **The category string is passed through verbatim, never sanitised.** `legend-view.ts` avoids the HTML sink entirely by building nodes with `textContent`; a model that rewrote the name would make the on-screen label disagree with the `<select>`.
- **Labels go through `heat-colours.ts`'s `formatScore`, not a local `round`.**
  Two decimals below 1e4 (multiplicative scores print as `3.6000000000000005`),
  exponential above it (DEC-R6b-6). **`minLabel` and `maxLabel` are the numbers
  the user actually reads** — `description` is only the strip's title — which is
  why this file having its own copy of `round` meant the sixth session's
  over-long number survived a fix applied to `describeScale` alone. The copy is
  gone; do not add another.

## Examples

```ts
const model = legendModel(fixedScale(1), "walkable", true, {
  aboveThresholdCount: snapshot.aboveThresholdCount,
  observedMax: snapshot.observedMax,
});
model.category; // "walkable"
model.minLabel; // "1"
model.maxLabel; // "1e4"  — the FIXED cap, the same everywhere
model.observedLabel; // "512.4" — what the data on screen actually reaches
model.bands.map((b) => b.label);
// ["0 — vetoed", "1 — nothing known", "up to 1 — below the bar"]
```

## Tests

- `legend-model.test.ts` — the category is named; the ends carry real numbers; a messy max is rounded; ramp swatches are distinct and ordered; `describeScale` survives as the description (DEC-13); a flat scale degrades to valid colours; bands appear only when asked, are exactly three, are mutually distinguishable, and the identity band is outline-only.
- `classifyScore` is covered in `legend-model.test.ts`: the three sub-threshold cases at the default threshold of 1, the identity staying distinct when the threshold is raised above it, and totality over non-finite scores.
- `legend-model.property.test.ts` — totality over hostile scales: no malformed colour, no `NaN`/`Infinity` label, category passed through verbatim, band count exactly `0` or `3`.

## Spelled-out ramp endpoints (DEC-U8 — 2026-08-19)

`minLabel`, `maxLabel` and `emptyMessage` are built with **`formatFixedScore`**;
`observedLabel` keeps `formatScore`.

The split is the decision: the ramp's endpoints come off a table constant and
are worth reading as numbers, while the observed maximum comes from the data and
genuinely reaches `1.7e11`, where a short form still earns its keep. See
`heat-colours.ts.md` for why the spell-out is bounded rather than unconditional.

**The collapsed header now hides the ramp and keeps the category name** (F3e,
DEC-U7) — a CSS rule in `index.html`, not a model change. It is **not** a
reversal of DEC-1, which requires a legend that NAMES the current category;
`.legend-category` still does.
