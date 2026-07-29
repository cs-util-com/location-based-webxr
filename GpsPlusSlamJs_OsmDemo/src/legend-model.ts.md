# `legend-model.ts`

**Purpose.** Decide what the legend says — the ramp swatches, the end labels, the three sub-threshold bands — as pure data, so the decisions can be tested without a browser.

## Public API

- `legendModel(scale, category, showBelowThreshold): LegendModel`
- `LegendModel` — `{ category, ramp, minLabel, maxLabel, bands, description }`.
  - `ramp` — `RAMP_STOPS` (7) swatches sampled **through `heatColour`**, geometrically spaced from `threshold` to `max`.
  - `description` — `describeScale(scale)` verbatim, for the strip's `title` / `aria-label`.
  - `bands` — empty unless `showBelowThreshold`; otherwise exactly three, in order `veto`, `identity`, `below`.
- `LegendStop` — `{ kind, colour, fill, label }`. `fill: false` means "draw the outline, leave the middle empty".
- `LegendStop.kind` — `"ramp" | "veto" | "identity" | "below"`.

The three band colours (`VETO_COLOUR`, `IDENTITY_COLOUR`, `BELOW_THRESHOLD_COLOUR`) are module-private **for now**. W7 makes `map-view.ts` paint the same three bands, and they must be exported then rather than duplicated — one source, or the legend becomes an active lie. They are not exported today because the dead-code gate is right that nothing else reads them yet.

## Invariants & assumptions

- **The ramp is sampled through `heatColour`, never re-derived from the palette.** A legend that interpolated its own copy of the ramp would drift from what the map paints, which is the one failure mode a legend cannot have.
- **The category name is part of the model.** The reported symptom was "switching category did not reset the map": the map does redraw, but every category scores nearly every rule and `heatScale` re-normalises to each category's own maximum, so the same hexagons return in similar colours. A picture that does not say what it is a picture _of_ cannot be checked by eye.
- **The identity band is outline-only (`fill: false`).** "No rule said anything here" must not paint a claim the data does not support — the assertion `map-view.ts` has always made in a comment, now made in pixels.
- **`0` is not the bottom of the ramp.** `VETO_COLOUR` is deliberately outside the viridis palette: a hard veto is a categorical statement ("never here"), not a low score, and colouring it as the ramp's dark end would put it on the same axis as a merely-weak cell. Telling those two apart is the entire point of DEC-7.
- **Total over every scale the sheet can produce.** Thresholds come from a publicly editable Google Sheet via `toNumber`, which accepts `0` and negatives — and `heatFraction` has a documented `#NaNNaNNaN` scar from exactly that. A property test asserts no colour is ever malformed and no label ever contains `NaN` or `Infinity`, for hostile scales including `threshold = 0` and `max < threshold`.
- **The category string is passed through verbatim, never sanitised.** `legend-view.ts` avoids the HTML sink entirely by building nodes with `textContent`; a model that rewrote the name would make the on-screen label disagree with the `<select>`.
- Labels round to 2 decimals: multiplicative scores print as `3.6000000000000005`.

## Examples

```ts
const model = legendModel({ threshold: 1, max: 8 }, "walkable", true);
model.category; // "walkable"
model.minLabel; // "1"
model.maxLabel; // "8"
model.bands.map((b) => b.label);
// ["0 — vetoed", "1 — nothing known", "up to 1 — below the bar"]
```

## Tests

- `legend-model.test.ts` — the category is named; the ends carry real numbers; a messy max is rounded; ramp swatches are distinct and ordered; `describeScale` survives as the description (DEC-13); a flat scale degrades to valid colours; bands appear only when asked, are exactly three, are mutually distinguishable, and the identity band is outline-only.
- `legend-model.property.test.ts` — totality over hostile scales: no malformed colour, no `NaN`/`Infinity` label, category passed through verbatim, band count exactly `0` or `3`.
