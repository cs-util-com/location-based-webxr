# `src/region-style.ts`

## Purpose

Decides how a merged affordance region is drawn on the 2D map (W15) — filled and
coloured by `medianScore` when the `areas` layer is on, outlined always.

## Public API

- `RegionStyle` — the Leaflet path options this module decides.
- `regionStyle(medianScore, scale, filled) → RegionStyle`.

## Invariants & assumptions

- **It is a separate module because `map-view.ts` imports Leaflet.** Anything
  living there can only be tested through a map instance; this decision is pure,
  and it is the half that can actually be wrong — the wrong colour, or a fill
  that never appears.
- **The colour comes from `heatColour`, the same function the cells, the legend
  and the 3D slabs use.** A region cannot read as "good" on the map and "poor" in
  the scene. That disagreement would be invisible, because each view stays
  internally consistent.
- **The dashed boundary is drawn in both states.** The fill answers "how good is
  this region"; the boundary answers "where does it end", and the second question
  does not stop mattering when the first is answered. A fill is also washed out
  at its own edge, which is exactly where the boundary is read.
- **`FILL_OPACITY` is 0.3, below the cells' 0.55, and that is DEC-R2-10.** That
  decision rejected a two-state `cells ↔ areas` switch specifically so a merged
  area can be seen _over_ the cells that produced it — the first check anyone
  performs when a region looks wrong. A fill as strong as the cells would make
  the pairing useless exactly when it is wanted.
- **The two states carry different `className`s.** Leaflet renders every polygon
  as an indistinguishable `<path>`, so an e2e asserting "regions are filled"
  would otherwise match the unfilled outline and pass while nothing had changed.
  The affordance cells already carry named classes for the same reason.
- **Hex channels are zero-padded.** `toString(16)` gives `"5"` rather than `"05"`,
  and `#5a0b0` is a colour Leaflet silently ignores — the region would draw in the
  browser default, which reads as a styling choice rather than as a bug.

## Examples

```ts
L.polygon(rings, regionStyle(region.medianScore, scale, fillRegions));
```

## Tests

`region-style.test.ts` — 8 tests across the two states: unfilled keeps the dash
and adds no fill and is not countable as one; filled uses `heatColour` for the
median score, tracks the score across regions, stays weaker than the cells, keeps
the boundary, is countable, and always emits six hex digits.

The colour assertions compare against `heatColour` rather than literal hex, so a
change to the map's ramp that did not reach here would fail — which is the
divergence the shared function exists to prevent.

`playwright-tests/` › "fills the regions on the MAP when the areas layer is on"
is the end-to-end half: it counts `path.region-fill` on and off, and reads the
`fill` attribute the browser actually applied.
