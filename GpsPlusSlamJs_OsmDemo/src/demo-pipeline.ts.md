# `src/demo-pipeline.ts`

## Purpose

Fetch → `AffordanceIndex` → scored cells and regions. The demo's whole data
path, with no DOM in it.

## Public API

- `class DemoPipeline` — `update(position, category, signal?): Promise<DemoSnapshot>` (the signal is checked PER TILE, which is where the saving is: a tile is 28-68 MB), `scoreFor(cell): CellScore | undefined` (so `explainCell` can be answered inside the worker, where the merged features already are),
  `features()`, static `chunkFor(position)`
- `interface DemoSnapshot` — `cells`, `regions`, `threshold`, `missingTiles`,
  `loadedTiles`, `stats`, `radius`
  - `radius` is which ring of the progressive widening this snapshot describes,
    normalised from `update`'s optional `radius` argument in ONE place so the
    snapshot cannot claim a ring the fetch loop never covered. Compare it against
    `SCORE_DISK_MAX_RADIUS` — or better, against `isFinalRing` in
    `refresh-cycle.ts`, which lives next to the list that defines "last" — to ask
    whether more snapshots are coming. See `refresh-cycle.ts.md`.
  - `loadedTiles` are the res-7 tiles currently held, surfaced so the map can
    DRAW the downloaded extent. "One res-7 tile" stays an abstraction until it
    is a box over a city — and the query covers the tile's bounding box, not the
    hexagon, which is a 1.39× difference worth seeing rather than being told.
    See `fetch-extent.ts.md`.

## Invariants & assumptions

- **`update` checks its `AbortSignal` TWICE, and both are load-bearing.** Once per
  tile in the fetch loop, and once again after the loop before scoring.
  - The per-tile check is where the bytes are: a tile is 28–68 MB.
  - The post-loop check exists because the per-tile one only fires when there IS a
    next tile, and at an interior position the working set needs exactly one. A run
    superseded during its single fetch would otherwise go on to score 19 chunks and
    931 cells for a position the user had already left. **A test found this** — see
    `demo-pipeline.test.ts`.
  - The signal is deliberately NOT threaded into `fetchTile`, which would need an
    `AbortSignal` through `OsmDataSource`, `CachingSource` and `OverpassSource` — a
    package API change and its own piece of work. The request already in flight
    completes; only the ones after it are skipped.

- **DOM-free and unit-tested, because the browser is a bad debugger.** Iteration
  8's value is a human judging a picture; getting the data to the picture is
  ordinary wiring that fails in ordinary ways, and separating the two is what
  makes "is the data wrong or the drawing wrong?" answerable.
- **This is the first real consumer of `AffordanceIndex`** — which is why the
  lifecycle layer was built before this iteration rather than during it.
- **Fetch failures are COLLECTED, not thrown.** A demo that dies because one of
  three tiles was rate-limited hides the two that arrived, and "some of the map
  is missing" is precisely the state the fetch policy degrades into by design.
  `missingTiles` is surfaced so the UI can say so.
- **Tiles already handed to the index are not refetched** on a redraw.
- **Still no store and no event emitter INSIDE this class**, though the reason
  has narrowed. The original claim was that the demo needed no shared-state
  layer at all — right for two write-only views and one input. Round-1 feedback
  added a legend, a details panel and a selected cell three views must agree on,
  so a Redux store now exists in `osm-store.ts` — but it sits **above** this
  file. This class stays a pure data producer: position and category in, a
  `DemoSnapshot` out, no subscriptions and no dispatch. That is what keeps "is
  the data wrong or the drawing wrong?" answerable by testing it in isolation.

- **`chunkFor` computes the chunk the SAME way `update()` does** —
  `latLngToCell(…, SCORE_CHUNK_RES)`, never `toScoreChunk` of a res-13 cell.
  The two are different functions: `toScoreChunk` walks the H3 **index**
  hierarchy, and H3 children are not geometrically contained by their parents.
  Four of sixty positions on a Cologne sweep disagreed, so a label built the
  index way names a different chunk than the one that was scored — and making
  the chunk grid legible is this view's entire job.

## The cell array is optional (round 10, stage B)

`update`'s fifth argument takes `{ includeCells }`, defaulting to `true`.

**Why it exists.** The array structured-clones across the worker boundary in a
measured 27–35 ms at the 488-chunk cap, three times per move — and in the
**default configuration the page draws none of it**. The `cells` layer is off
(DEC-R7b-5/R7b-6, because the map would draw one Leaflet polygon per cell), the
regions are computed here, and the only other thing the page did with the array
was derive `heatScale`'s `max`. So ~24 000 cells travelled to produce one number.

The snapshot now reports that number as `heatMax`, plus `cellCount` for the
status line, and the array is skipped when nothing draws it. `regions`,
`threshold`, `heatMax` and `cellCount` are reported either way, so the visible
surface is identical.

**This withholds nothing from anything that needs cells.** Cell-level algorithms
run _here_, against the index: the geo-event's hill climb makes thousands of
`cellState` reads as synchronous callbacks that cannot cross a structured clone,
so it returns a finished event rather than the field it walked. NPC navigation is
designed the same way — its plan notes that `connectedComponents` produces
"coloured slabs for display, not a traversal graph". The rule both follow is
**compute where the data lives, send the answer**, and `includeCells` is a flag
rather than a deletion because the cells layer still needs the array when it is
switched on.

## Examples

```ts
const pipeline = new DemoPipeline({ source, table });
const snapshot = await pipeline.update({ lat: 50.94, lng: 6.96 }, "walkable");

// The default configuration: regions, threshold, heatMax and cellCount, but no
// ~24 000-cell array to clone.
const lean = await pipeline.update(at, "walkable", undefined, undefined, {
  includeCells: false,
});
```

## Tests

`demo-pipeline.test.ts` covers `chunkFor` — four positions where the two
plausible computations diverge, plus a 1600-point sweep. The rest is covered
indirectly through `heat-colours.test.ts` and by the package gate's typecheck
against the real `gps-plus-slam-osm` API. Its remaining behaviour (fetch failure
collection, no-refetch) is worth a test with a fake source — see the follow-ups
doc.

It also holds **the snapshot's serialisability guard**, which lives here rather
than in `osm-store.test.ts` on purpose: `osm-store.ts` excludes the snapshot
from RTK's runtime scan on both the action and the state side, and a round-trip
of a fixture written next to the assertion would only prove the fixture is
serialisable. This drives the real producer and round-trips what it emits.

- The fixture is a **way**, not a node — a node scored too few adjacent cells to
  form a connected component, so `snapshot.regions` was `[]` and the guard never
  reached the only deeply nested part of `DemoSnapshot` (`outline` is three
  levels of array) nor its `minScore`/`maxScore`, which can be `±Infinity` and
  which `JSON.stringify` turns into `"null"` without a word. All three
  collections are now asserted non-empty.
- The comparison is `toStrictEqual`. `toEqual` ignores object type mismatch, so
  a class instance with plain data fields round-trips to an equal plain object —
  precisely what RTK's `isPlainObject` scan would have caught, so the
  replacement would otherwise have been weaker than what it replaced. A
  companion test asserts both halves of that difference, so loosening the guard
  back to `toEqual` fails a line rather than going quiet.
