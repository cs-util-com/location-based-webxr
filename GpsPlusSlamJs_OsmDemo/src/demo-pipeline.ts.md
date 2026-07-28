# `src/demo-pipeline.ts`

## Purpose

Fetch → `AffordanceIndex` → scored cells and regions. The demo's whole data
path, with no DOM in it.

## Public API

- `class DemoPipeline` — `update(position, category): Promise<DemoSnapshot>`,
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
- No store and no event emitter: a second abstraction between the index and the
  map would only obscure which of the two produced a wrong answer.

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
