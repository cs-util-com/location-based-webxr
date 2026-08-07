# h3-proximity.ts

## Purpose

Shared H3 hexagonal grid utilities for reference point identity and matching. Replaces user-typed string IDs with deterministic GPS-derived H3 indices.

## Public API

| Symbol                   | Signature                                                             | Description                                                                                                                                       |
| ------------------------ | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `H3_RESOLUTION`          | `11` (const)                                                          | H3 resolution: ~25m edge, ~65m gridDisk safe zone                                                                                                 |
| `KnownGeoAnchor`         | `{ h3Index: string; displayName?: string; lat: number; lon: number }` | Interface for proximity matching (lat/lon needed for distance ranking)                                                                            |
| `approxDistanceMetres`   | `(lat1, lon1, lat2, lon2) => number`                                  | Equirectangular distance approximation, accurate < 1 km                                                                                           |
| `gpsToH3`                | `(lat: number, lng: number) => string`                                | Compute H3 res-11 index from GPS                                                                                                                  |
| `gpsPathToCoverageCells` | `(path: {lat,lng}[]) => string[]`                                     | Deduped res-11 cells a GPS path crossed, in first-seen order — the per-tour coverage index. Skips non-finite coords.                              |
| `clusterCellsByZoom`     | `(cells: string[], targetRes: number) => string[]`                    | Coarsen coverage cells for a map zoom via `cellToParent` (NEVER string truncation). Clamps `targetRes` to `[0, 11]`; skips invalid cells; dedups. |
| `findNearbyGeoAnchor`    | `(lat, lng, KnownGeoAnchors) => KnownGeoAnchor \| undefined`          | Find closest ref point within gridDisk(cell, 1) safe zone; ranks by distance when multiple candidates overlap                                     |
| `h3CellsMatch`           | `(h3a: string, h3b: string) => boolean`                               | Cross-session matching: checks if two H3 indices are within each other's gridDisk(cell, 1)                                                        |
| `isH3Index`              | `(id: string) => boolean`                                             | Checks if a string looks like an H3 res-11 index (15-char lowercase hex)                                                                          |

## Invariants & Assumptions

- H3 resolution 11 produces 15-character lowercase hex strings
- `gridDisk(cell, 1)` returns 7 cells (center + 6 neighbors), radius ~65m
- Same physical location within ~25m GPS jitter always lands in the same cell or a neighbor
- Ref points >130m apart always produce non-overlapping gridDisk zones
- When multiple ref points fall in the gridDisk safe zone (65–130 m apart), `findNearbyGeoAnchor` returns the closest by equirectangular distance — result is independent of array order
- `h3CellsMatch` is NOT symmetric in edge cases (gridDisk overlap is checked from A to B only), but for res-11 this is practically symmetric
- **Zoom-clustering coarsens via `cellToParent`, never hex-string truncation.** H3 encodes resolution in the high bits (2nd hex char) with trailing `f` padding, so slicing the id yields an _invalid_ cell, not a parent (verified — see the D1 gotcha in `GpsPlusSlamJs_Docs/docs/2026-06-14-1048-map-centric-recording-browser-and-h3-index-user-feedback.md`).
- `clusterCellsByZoom` clamps `targetRes` to `[0, H3_RESOLUTION]`: `cellToParent` throws for a finer res than the cell, and res 11 is the finest stored data, so `cellToParent(cell, 11) === cell` (highest zooms are unclustered). A non-finite `targetRes` degrades to unclustered output.
- Both coverage helpers are defensive: `gpsPathToCoverageCells` skips non-finite coords; `clusterCellsByZoom` skips cells failing `isValidCell` **and** valid cells whose own resolution is coarser than `targetRes` (no parent at the finer res → `cellToParent` would throw "incompatible resolutions"). The `targetRes` clamp only bounds the requested res, not the input cell's res, so this is a separate guard.

## Examples

```ts
const h3 = gpsToH3(50.7475, 6.4812); // "8b1f1a5c2e3d4f1"
const match = findNearbyGeoAnchor(50.7475, 6.4812, [
  { h3Index: h3, displayName: 'Bank', lat: 50.7475, lon: 6.4812 },
]);
// match === { h3Index: "8b1f1a5c2e3d4f1", displayName: "Bank", lat: 50.7475, lon: 6.4812 }
h3CellsMatch(h3, h3); // true
isH3Index(h3); // true
isH3Index('Bank'); // false

// Distance helper
approxDistanceMetres(50.7475, 6.4812, 50.74825, 6.4812); // ~83 m

// Per-tour coverage index + map zoom-clustering
const cells = gpsPathToCoverageCells([
  { lat: 50.7495, lng: 6.4793 },
  { lat: 50.7475, lng: 6.4812 },
]); // deduped res-11 cells, first-seen order
const tiles = clusterCellsByZoom(cells, 9); // res-9 parents for a zoomed-out map
```

## Tests

- `h3-ref-point.test.ts` — 25 tests covering h3-js integration, gpsToH3, findNearbyGeoAnchor (including closest-match ranking), h3CellsMatch, isH3Index
- `h3-ref-point.property.test.ts` — 5 property-based tests for distance helper metrics and closest-match array-order independence
- `h3-coverage.test.ts` — 13 unit tests for `gpsPathToCoverageCells` (dedup, first-seen order, defensive non-finite skip) and `clusterCellsByZoom` (the **D1 `cellToParent`-not-truncation regression guard**, `targetRes` clamping, sibling-merge, invalid-cell skipping)
- `h3-coverage.property.test.ts` — 6 property-based tests asserting validity/uniqueness/order-stability of coverage cells and validity/monotonicity/parent-membership of zoom-clustering
- `h3-retroactive.test.ts` (in investigation/) — 4 tests validating H3 consistency on real rec3-rec5 recordings
