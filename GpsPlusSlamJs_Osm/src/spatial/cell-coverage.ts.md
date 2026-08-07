# `spatial/cell-coverage.ts`

## Purpose

Which affordance cells does a geometry touch? The bridge between OSM geometry
and the H3 grid, and the hot path of the whole package.

## Public API

- `coverCells(geometry, resolution?): CellCoverage[]`
- `dilate(cells, rings): string[]`
- `cellCentre(cell): LatLng`
- `CellCoverage`: `{ cell, fraction }`

## Invariants & assumptions

- **TOUCHED, not contained.** Uses `polygonToCellsExperimental` with
  `containmentOverlapping`. Plain `polygonToCells` is centre-containment only, so
  a cell a building clips through — but whose centre falls outside — is silently
  dropped, which would report the ground under a building's edge as walkable.
  This matches the C# reference's binary-overlap behaviour, which is what keeps
  its published oracle values valid.
  - The obvious property "every returned cell's centre is inside the polygon" is
    **false by construction** for this mode. There is a test asserting the
    opposite, so nobody "fixes" it back to `containmentCenter`.
  - The function is experimental upstream, so it is wrapped here and pinned by
    our own tests. `h3-js >= 4.2.1` is the floor that has it.
- **`fraction` is hardcoded to `1.0` and is NOT a computed value.** The C#
  overlap is binary — a 4 m cell grazed by a 1 cm corner is vetoed exactly as
  hard as one entirely inside — and carrying that flaw forward keeps the oracle
  usable. The field exists so a coverage-weighted mode can arrive without a
  data-model change.
- **Linestrings are supercovered, not vertex-sampled.** OSM maps long straight
  roads as two distant nodes; sampling vertices would register 2 cells for a
  200 m road and leave ~47 cells unscored — silently, and looking like unmapped
  ground. `gridPathCells` gives the contiguous H3 line; when it throws (very long
  spans, pentagon distortion) the endpoints are kept rather than the way dropped.
- **A feature smaller than one cell is never lost.** A polygon that touches no
  cell under overlapping containment falls back to its vertices — a 2 m kiosk
  must still veto the cell it stands in.
- Holes are subtracted: h3 takes `[outer, ...holes]` and honours them, so a
  courtyard is not covered by its building.
- Non-finite coordinates are skipped rather than producing a bogus cell.
- Results are duplicate-free and unordered.

## Cost

Measured 2026-07-28 (desktop Node), indexing a 19-chunk working set: 2.8–8.7 ms
per chunk depending on density. The dense-city fixture is at ~87 % of the plan's
10 ms budget, which is why the Web Worker requirement is load-bearing rather
than precautionary.

**Callers indexing against a working set must clip first** — see `clip.ts`.

## Examples

```ts
const cells = coverCells(geometry); // res 13 by default
for (const { cell, fraction } of cells) index.add(cell, feature, fraction);
```

## Tests

`cell-coverage.test.ts` (points, polygons including the superset-of-centres and
the non-property, holes, sub-cell features, degenerate rings, supercover lines,
multipolygons, the fraction placeholder, dedup) and
`cell-coverage.property.test.ts` (monotonicity, the full ⊆ centre ⊆ overlapping
mode ordering, non-emptiness, line contiguity, winding independence).
