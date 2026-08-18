# `src/worker/obstacle-index-cache.ts`

## Purpose

Holds the navigation obstacle index in the worker and rebuilds it **only when the
feature set moves** — so many route requests over one publish pay for one res-13
`coverCells` sweep (DEC-R11-16, amended by DEC-R11-19).

## Public API

- `createObstacleIndexCache(build): ObstacleIndexCache` — `build` is injected
  (production passes `buildObstacleIndex`) so the lifetime can be asserted
  without constructing a real index.
- `ObstacleIndexCache`
  - `get(key: number, features: () => Iterable<OsmFeature>): ObstacleIndex` —
    `features` is a **thunk**, called at most once and only on a miss.
  - `buildCount(): number` — how many times `build` actually ran.
  - `lastBuildMs(): number | undefined` — the last build's cost; `undefined`
    before the first.

## Invariants & assumptions

- **The key is the FEATURE SET, not the mesh build.** Production passes
  `pipeline.loadedTileCount()`, which `DemoPipeline` documents as "a faithful
  signature of the feature set" — tiles are only ever added, never removed or
  replaced.
  - The wiring NOT to use is `buildMesh`, whose `needsFullBuild` inputs include
    `terrainStamp`. Terrain does not change what blocks an agent, so keying on
    that would re-run the sweep for a DEM refresh.
- **Built on demand, not on the publish path** (DEC-R11-19). The index appears
  on the first route request of a feature set, so a session where nobody orders a
  route pays nothing. Every property DEC-R11-16 asked for still holds — one build
  per feature set, in the worker, off the main thread.
  - The cost of that choice, stated: the first click after a new tile lands is
    slower by one index build. See `demo-worker.ts.md` for the measured figure.
- **One entry, not a map.** Keys are monotonic, so an older key is one that will
  never be asked for again and caching it would hold a superseded feature set
  alive. Returning to an older key therefore rebuilds — pinned as a test so it
  reads as a decision rather than as a bug.
- **No validation of `key`.** It is an internal signature produced one call away;
  a caller that passes a constant gets a cache that never invalidates, which is
  exactly what the mirror test in the suite exists to catch at the wiring level.

## Examples

```ts
const obstacleIndex = createObstacleIndexCache(buildObstacleIndex);

// In the worker's `planRoute` handler — one build per publish, not per click.
const index = obstacleIndex.get(pipeline.loadedTileCount(), () =>
  pipeline.features().values(),
);
return planRouteWithIndex(index, from, to, { frame, field });
```

## Tests

`obstacle-index-cache.test.ts`, and the first two are a **pair that only works
together**:

- _builds ONCE for many requests over one publish_ — the saving DEC-R11-16's
  reasoning rests on.
- _builds AGAIN when the feature set moves_ — the mirror. Without it, a cache
  that never invalidates passes the first test perfectly and then routes an agent
  around a wall that is no longer in the working set.
- _does not materialise the features on a hit_ — the thunk is load-bearing, not
  decoration.
- _holds ONE entry_ — pins the deliberate trade so it is not "fixed" into a map.
- _reports what the last build cost_ — asserts the SHAPE (undefined, then a
  finite number), never a duration, because a timing threshold in a unit test is
  a flake.

The real builder's cost against the checked-in corpus is measured in
`GpsPlusSlamJs_Osm/src/testdata/sites/site-obstacle-index-cost.test.ts`.
