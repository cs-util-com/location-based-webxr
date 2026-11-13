# `mesh/cosmetic-trees.ts`

## Purpose

Invents the trees that a mapped wood (`landuse=forest`, `natural=wood`), an
orchard (`landuse=orchard`) or a tree row (`natural=tree_row`) implies but does
not map one by one, as `TreePlacement`s flagged `cosmetic: true`. Port of the O1
quiet-greens lab the owner chose (city objects plan 2026-11-07-2315 M2a).

## Public API

- `buildCosmeticTrees(features, options) → CosmeticTreePlacement[]`, in rank
  order. `options`:
  - `frame` (`EnuFrame`), `groundHeightM?` (as every builder);
  - `window: Bbox` (lat/lng), **required**: no tree is placed outside it;
  - `excludeRings?`: ENU rings no wood or orchard tree stands inside (`buildCity`
    passes every built building footprint);
  - `densityPerM2?` (default `COSMETIC_WOOD_DENSITY_PER_M2`, 0.02), above zero;
  - `cap?` (default `COSMETIC_TREE_CAP`, 20,000), a whole number above zero or
    `Infinity`;
  - `roadMarginM?` (default `COSMETIC_ROAD_MARGIN_M`, 1), zero or more.
  - RangeError for a missing, non-finite or empty window and for any option out
    of range, checked before anything else (also with no woods in the input).
- `CosmeticTreePlacement` = `TreePlacement` plus `key` (stable per tree),
  `source` (`wood` | `orchard` | `tree_row`) and `cosmetic: true`; its `feature`
  is the wood, orchard or row it was invented for.
- `cosmeticTreeSource(feature)`: which source a feature is, or undefined (nodes
  never are).
- `cosmeticRank(key)`: the seeded rank in [0, 1) the output is sorted by.
- Exported constants: `ORCHARD_HEIGHT_M` 4.5, `TREE_ROW_SPACING_M` 8.
  Module-private: `WOOD_HEIGHT_FACTOR` 1.5, `ORCHARD_SPACING_M` 6,
  `TREE_ROW_CLEAR_M` 4 (no caller outside the module).

## Invariants & assumptions

- **Woods: one tree per cell of a GLOBAL grid** in latitude and longitude. A row
  is `step / ENU_METRES_PER_DEG_LAT` degrees tall (`step = 1 / sqrt(density)`
  metres), a cell in row j `step / (ENU_METRES_PER_DEG_LNG_EQUATOR *
cos(row centre))` degrees wide; the tree stands at 0.15 + 0.7 * hash of the
  cell along each axis. So one wood gives the same trees in every frame, to
  floating point (property-tested to 1 mm with origins 5 km apart): OsmDemo
  re-anchors as the user walks, the globe frames every city differently. O1
  anchored its grid to the fixture's frame; that is the deliberate difference.
- **Overlapping woods share cells**: the jitter comes from the cell alone, and
  woods are visited in feature-key order, so the first wood by key takes a
  shared cell, whatever order the input came in.
- **Orchards: a 6 m grid along the longest edge of the unclipped outer ring**,
  from its first vertex, in a frame anchored there (jitter plus or minus 8 % of
  the spacing), so neither the caller's frame nor the window moves a tree.
  Unknown leaf type becomes broadleaved; height 4.5 m jittered.
- **Rows: every 8 m along each line, half a step in**, the whole line walked in
  a frame at its first vertex (indices do not depend on the window); a tree
  within 4 m of a mapped `natural=tree` is dropped. Rows are NOT excluded from
  roads or buildings (a mapped row stands along a road by definition; O1 did
  the same). A closed row (mapped as a ring) is walked along its ring.
- **Exclusions (woods and orchards)**: inside an `excludeRings` ring, or within
  `roadWidthM(tags) / 2 + roadMarginM` of any `isRoad` way (the library's widths,
  not O1's own table), bucketed on 16 m cells, bucketing only what touches the
  window.
- **No spread over candidates**: each source's candidates are appended one by
  one, never `push(...list)`, which throws `RangeError: Maximum call stack size
exceeded` above roughly 100-125 k elements; one forest covering the OSM
  demo's drawn window at Heidelberg reached that (2026-11-10).
- **The window**: wood and orchard areas are clipped to it (`clipToBbox`) before
  the point-in-polygon test (by crossing parity over all rings, so holes are
  outside), and every candidate is tested against it, rows included.
- **Look**: wood trees `DEFAULT_TREE_HEIGHT_M * 1.5`, jittered 0.75 to 1.25 by
  the tree's key; a `mixed` wood picks needle or broad per tree (hash of the key
  below 0.5 is needle), with an unknown cycle; crown `heightM *
DEFAULT_CROWN_RATIO`; colour `treeColour` of the resolved class by the tree's
  key; yaw `stableRotationY(key)`.
- **Order and cap**: sorted by `cosmeticRank(key)` (ties by key); the first
  `cap` are kept. Rows count against the cap too (O1 capped woods and orchards
  only). The order is what a consumer that draws the first n instances (M2b's
  phone governor) thins by.
- Nothing here is an `OsmFeature`, so navigation and scoring cannot see it.

## Examples

```ts
const trees = buildCosmeticTrees(features, {
  frame: enuFrameAt(centre),
  window: fetchedBbox,
  excludeRings: volumes.map((v) => v.footprint),
});
```

## Tests

- `cosmetic-trees.test.ts`: the sources; a wood inside its ring, with a hole,
  outside excluded rings and road half widths at margins 0, 1 and 2 m, inside
  the window, overlapping woods sharing cells, heights, mixed and typed forms,
  empty and degenerate areas; the orchard grid on a rotated orchard; row spacing,
  a bend and the mapped-tree clearance; rank order, the cap keeping the lowest
  ranks spread over the wood, an infinite cap; the RangeErrors; the count
  scaling with density 0.005 / 0.01 / 0.02; a wood with 300 000 candidate
  cells (the spread overflow).
- `cosmetic-trees.property.test.ts`: density within 10 % on random star polygons
  above 1 ha at three densities; the same trees in frames up to 5 km apart (1 mm);
  input order; nothing outside a random window (a row included).
- `testdata/sites/site-cosmetic-trees.test.ts`: Hinterzarten's pinned count, its
  relations' trees inside the window, the mapped trees unchanged, and the
  obstacle index and cell scores byte-identical with the switch on and off.
