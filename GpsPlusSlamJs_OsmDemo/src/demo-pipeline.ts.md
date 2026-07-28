# `src/demo-pipeline.ts`

## Purpose

Fetch → `AffordanceIndex` → scored cells and regions. The demo's whole data
path, with no DOM in it.

## Public API

- `class DemoPipeline` — `update(position, category): Promise<DemoSnapshot>`,
  `features()`, static `chunkFor(position)`
- `interface DemoSnapshot` — `cells`, `regions`, `threshold`, `missingTiles`,
  `stats`

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

## Examples

```ts
const pipeline = new DemoPipeline({ source, table });
const snapshot = await pipeline.update({ lat: 50.94, lng: 6.96 }, "walkable");
```

## Tests

Covered indirectly through `heat-colours.test.ts` and by the package gate's
typecheck against the real `gps-plus-slam-osm` API. Its own behaviour (fetch
failure collection, no-refetch) is worth a test with a fake source — see the
follow-ups doc.
