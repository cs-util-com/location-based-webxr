# `fetch-extent.ts`

## Purpose

Measures and describes how much ground one Overpass fetch actually covers, so
the demo can draw it and put a number on it.

## Public API

- `tileBounds(tile: string): Bounds` — the H3 cell's bounding box, i.e. exactly
  what `buildTileQuery` asks Overpass for.
- `summariseExtent(tile: string): ExtentSummary` — `widthKm`, `heightKm`,
  `boxAreaKm2`, `hexAreaKm2`, `overFetch`.
- `describeExtent(tiles: readonly string[]): string` — the status-line label.

## Invariants & assumptions

- **The query covers the tile's BOUNDING BOX, not the hexagon**, because
  Overpass has no hexagon primitive. This is the whole reason the module exists:
  the red box on the map is the honest answer to "what did we download", and it
  is strictly larger than the tile the index keys on.
  - Measured at Cologne (res 7): a **2.47 × 2.55 km box = 6.3 km²** against a
    **4.5 km² hexagon** — **1.39×**.
  - **Nothing in the corners is discarded**, and an earlier version of this note
    wrongly said otherwise. No hexagon filter exists on the ingest path:
    `acceptTile` merges every feature the response contained and scoring
    bbox-tests against the CHUNK. The hexagon is a cache and invalidation key,
    not a spatial filter. The 1.39× costs redundant **transfer** — neighbouring
    tiles' bboxes overlap, so shared ground is downloaded once per tile that
    covers it — not discarded data.
  - **Shrinking the tile is still not the move, but the reason changed.**
    - The old reason is **superseded**: under the pre-F32 `nwr` form the payload
      barely tracked area (res 9 is 49× less ground and still returned 38.7 MB
      against 68.0 MB), so a smaller tile bought nothing. That form was retired
      2026-08-03.
    - The current reason: areal-only restored proportionality (res 7 → res 9 is
      21×), so a smaller tile _would_ be smaller — but `FETCH_RES` was raised
      8 → 7 deliberately to trade bytes for a lower request count, and that
      trade is unaffected by payload size. A res-7 fetch is **~21 MB at a ~20 s
      median**. See the benchmark results doc.
- **The hexagon area is exact, the box area is not.** `hexAreaKm2` comes from
  H3's own `cellArea`; the box uses an equirectangular approximation with
  longitude scaled by the mid-latitude cosine. Mixing two approximations would
  make `overFetch` a claim about this module rather than about the geometry.
  At ~2.8 km the box error is far below what the display is used for, and a
  geodesic area would imply precision the picture does not have.
- **`describeExtent` says "box" explicitly.** A bare "2.8 km" invites the reader
  to assume it is the hexagon — the exact misreading the display exists to
  correct.
- **Never emits `NaN` or `Infinity`.** The label sits beside the scoring
  numbers, so a non-finite value there would be blamed on the scoring. A
  zero-area cell yields `overFetch: 0` rather than a division by zero.
- **No DOM.** The arithmetic is separated from `map-view.ts` precisely so it can
  be unit-tested — the view is Leaflet wiring with no unit tests, which is the
  gap the `?lat=&lng=` guard and the click race both fell into.

## Examples

```ts
const summary = summariseExtent(tile); // { widthKm: 2.47, overFetch: 1.39, … }
status.textContent = describeExtent(snapshot.loadedTiles);
mapView.renderFetchTiles(snapshot.loadedTiles);
```

## Tests

`fetch-extent.test.ts` — the box containing its own hexagon's centre, res-7
dimensions in the right order of magnitude (catching metres-as-km and a dropped
longitude cosine at once), the over-fetch necessarily exceeding 1 while staying
under 2, the hex area coming from H3, and the label wording, multi-tile summing,
empty case and non-finite guard.

`playwright-tests/` — asserts both `path.fetch-extent` and
`path.fetch-tile-hex` reach the screen and that the status line carries the
numbers, since a zoomed-out map makes the picture alone uninformative.
