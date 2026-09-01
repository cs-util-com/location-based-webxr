# `regions/region-builder.ts`

## Purpose

Turns components into regions with exact outlines and statistics.

## Public API

- `buildRegion(component, category, scoresByCell): Region`
- `buildRegions(components, category, scoresByCell): Region[]`
- `regionId(cells): string`
- `Region`: `id`, `category`, `outline`, `cells`, `cellCount`, `areaM2`,
  `medianScore`, `minScore`, `maxScore`, `osmSourceIds`

## Invariants & assumptions

- **The outline is EXACT, not a hull.** This is the other half of what the
  geohash→H3 move buys. The reference finished its flood fill with a concave hull
  carrying `DEFAUT_MAX_EDGE_LENGTH_RATIO = 0.69` — misspelled, public, and
  unexplained beyond _"any value between 0.69 and 0.99 seems to work that the
  geometry does not become convex"_. That constant existed because a rectangular
  grid's filled region has no exact boundary you can read off the grid.
  `cellsToMultiPolygon` gives the boundary by construction, so the hull, the
  constant and the guesswork all disappear. A region with a hole (a building
  inside a park) gets that hole as a second ring, for free.
- **Coordinates are converted to `{ lat, lng }`.** h3 returns GeoJSON order
  (`[lng, lat]`); leaving that unconverted is a trap that shows up as geometry
  off the coast of Africa.
- **`medianScore`, not a mean.** Scores are unbounded and multiplicative, so one
  heavily-mapped cell can be orders of magnitude above its neighbours and would
  drag a mean with it. The median describes the region a user is standing in.
  - It uses the package's shared [`utils/median.ts`](../utils/median.ts.md) —
    the interpolating rule, so an even cell count averages the two middle
    scores. This module used to carry its own copy of that function under the
    same name; the two agreed, but nothing held them to it.
  - The `?? 1` at the call site **narrows the type, it is not a reachable
    default**: `scores` has one entry per cell and an empty component throws,
    so the empty case cannot occur.
- **A cell with no score is treated as the identity, not dropped.** A lookup miss
  must not silently shrink a region — the cell is in the component because
  something put it there.
- `areaM2` sums real per-cell areas rather than multiplying by an average, so it
  stays right near pentagons and at high latitude.

## ⚠ Region identity is a shape at a moment, not a place forever

`regionId` is **the lowest-sorting cell id in the component** — deterministic,
order-independent and free.

Its failure mode is real: **when two regions merge as more data loads, BOTH ids
change**, because the merged component's lowest cell is the lower of the two.
One id survives, the other vanishes.

**Consumers must not persist a region id as a long-lived key.** Fixing this
properly needs a notion of "place" that this layer does not have, which is why it
is documented and tested rather than worked around.

## Examples

```ts
const scoresByCell = new Map(scored.cells.map((c) => [c.cell, c]));
const regions = buildRegions(
  connectedComponents(cellsAboveThreshold(scored, "walkable", 1)),
  "walkable",
  scoresByCell,
);
```

## Tests

`regions.test.ts` — closed exact outlines, coordinate order, the absence of a
tuning knob, cell/area statistics, median-vs-outlier, contributing element
collection, missing-score handling, identity stability and its merge failure
mode, and the JSON round-trip regions need for caching.
