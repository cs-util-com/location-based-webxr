# `src/demo-pipeline.ts`

## Purpose

Fetch → `AffordanceIndex` → scored cells and regions. The demo's whole data
path, with no DOM in it.

## Public API

- `class DemoPipeline` — `update(position, category, signal?): Promise<DemoSnapshot>` (the signal is checked PER TILE, which is where the saving is: a tile is 28-68 MB), `scoreFor(cell): CellScore | undefined` (so `explainCell` can be answered inside the worker, where the merged features already are),
  `features()`, static `chunkFor(position)`
- `interface DemoSnapshot` — `cells`, `regions`, `threshold`, `missingTiles`,
  `loadedTiles`, `stats`
  - `loadedTiles` are the res-7 tiles currently held, surfaced so the map can
    DRAW the downloaded extent. "One res-7 tile" stays an abstraction until it
    is a box over a city — and the query covers the tile's bounding box, not the
    hexagon, which is a 1.39× difference worth seeing rather than being told.
    See `fetch-extent.ts.md`.

## Invariants & assumptions

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

## Examples

```ts
const pipeline = new DemoPipeline({ source, table });
const snapshot = await pipeline.update({ lat: 50.94, lng: 6.96 }, "walkable");
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
