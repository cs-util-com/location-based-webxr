# globe-city-worker-core.ts

## Purpose

The globe city's worker as a core an app's worker shell wires to the Osm
library: one city load at a time, on the relief's own heights, built on
each delivery, answered in the messages `globe-city.ts` reads. The Osm
library is handed in, so this package keeps no dependency on it, and the
protocol runs under a unit test without a worker. The Tour Viewer's
`src/editor3d/globe-city-worker.ts` is such a shell. The design system's
globe lab keeps its own no-build copy of the same protocol
(`labs/globe/globe-city-worker.js`); moving the lab onto this core is a
filed follow-up.

## Public API

- `createCityWorkerCore(deps)` -> `{ handle(data) }`, `deps` a
  `CityWorkerDeps`:
  - `post(message, transfer)`: the worker's `postMessage`;
  - `openStore()`: the tile store (the shell's persistent store, or one in
    memory), asked for once for the worker's life;
  - `osm`: the Osm library's `cityDataPlan`, `loadCityData`, `buildCity`,
    `createCityTileSource`, `createCachingTileFetch`, `browserPngDecoder`,
    `TERRAIN_EXTENT_M` and `TERRARIUM_URL_TEMPLATE` (`CityWorkerOsm`,
    typed structurally: only what the core reads);
  - `userAgent`: how the app names itself to the Overpass operators;
  - `now` (default `performance.now`): the clock of `buildMs`.
- `handle(data)` takes the page's messages:
  - `{ kind: "load", id, target, zoom, deepZoom?, heightsUrl?, firstRings? }`:
    stops the load before and starts `loadCityData` for `target` on
    `cityHeights(zoom, heightsUrl ?? TERRARIUM_URL_TEMPLATE)`. With a
    `deepZoom` above `zoom` it first asks for every height tile of the
    window at `deepZoom` (the first alone, then the rest together, through
    the caching fetch the load then reuses, so they are its cache hits)
    and plans on `deepZoom` only when every one answers 200: the relief
    draws a missing deep tile from its global zoom, so the city reads the
    global zoom everywhere rather than stand on a patchwork. The lab's
    no-build copy sends no `deepZoom` and reads the load's zoom;
  - `{ kind: "abort", id }`: stops that load, if it is the current one;
  - anything else is ignored.
- Replies, each with the load's `id`:
  - `progress` (`counts`, `progress`, `landing`);
  - `city` with `ok: true`, `stage`, `buildings`, `trees`, `roads`,
    `counts` (`features`, `tiles`, `missingTiles`, `volumes`, `barriers`,
    `trees`, `roads`, `buildMs`, `heightsZoom`: the zoom the heights were
    read at) and `groundM`, the buildings' and roads'
    buffers transferred (each once);
  - `settled` (every job tried once), then `finished` (after the retries);
  - `city` with `ok: false` and a `message` for a load that ended without
    a city (a height still missing, or no data), before its `finished`.

## Invariants & assumptions

- One load at a time; a superseded or aborted load's late replies are
  dropped, and a load superseded while the store opened, or while its
  deep tiles were asked for (those requests are called off), never starts.
- The deep probe costs requests: the city's window holds 9-25 height tiles
  at zoom 14 (16 at Munich and Bern, 25 at Oslo, 9 at Quito; `cityDataPlan`,
  counted 2026-11-04) against 2-4 at zoom 12, each a cache hit on the next
  visit; a source without the deep zoom here costs one request.
- Bad input is answered, never thrown: a target that is not finite, or a
  zoom or template `cityHeights` refuses, replies `city` `ok: false` and
  `finished` `invalid-target`; a load that throws replies `city`
  `ok: false` and `finished` `settled`.
- No city stands on invented heights: `buildCity` runs only on the
  library's deliveries, within `TERRAIN_EXTENT_M`.
- The build window is the delivery's `window` (the loaded tiles' box,
  city objects plan 2026-11-07-2315 section 4), and `cosmeticTrees: false`:
  the globe draws no cosmetic woods until objects M2b wires them, so the
  worker builds none. Likewise `furniture: []`: the library default builds
  all four street furniture kinds, and the globe draws none yet (pinned in
  the test next to `cosmeticTrees: false`). And `inventedRoofs: false`:
  with the tiles cached (a revisit, the Tour Editor's normal case) the build
  is the delivery, and invented roofs multiply it by about 1.9 to 4.5
  (Heidelberg and Meggen, the central half and the whole of the data box;
  the library bench `GpsPlusSlamJs_Osm/src/mesh/globe-invented-roofs.bench.ts`),
  past the plan's rule of "more than doubles". The globe draws the flat
  tops the map implies; OsmDemo keeps the invented roofs.

## Example

```ts
const core = createCityWorkerCore({
  post: (message, transfer) => self.postMessage(message, transfer),
  openStore: async () =>
    (await openPersistentOsmStore()) ?? new MemoryBlobStore(),
  osm: { loadCityData, buildCity, cityDataPlan /* ... */ },
  userAgent: "my-app",
});
self.onmessage = (event) => core.handle(event.data);
```

## Tests

- `globe-city-worker-core.test.ts` (recording fakes of the Osm library and
  the store): a load on the relief's heights replying progress, city,
  settled and finished with each buffer transferred once; supersession and
  the dropped late replies; the store opened once; an abort of the named
  load only; a load superseded while the store opened; the deep zoom read
  where every deep tile answers, the global one where one is missing (404)
  or fails (first or last), the probe called off on abort, a deep zoom at
  the global one asking nothing and one above 15 refused; a load without a
  city saying why; a bad target, a bad zoom and a throwing load answered;
  other messages ignored.
