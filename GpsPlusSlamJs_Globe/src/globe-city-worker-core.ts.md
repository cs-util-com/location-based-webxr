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
  - `{ kind: "load", id, target, zoom, heightsUrl?, firstRings? }`: stops
    the load before and starts `loadCityData` for `target` on
    `cityHeights(zoom, heightsUrl ?? TERRARIUM_URL_TEMPLATE)`;
  - `{ kind: "abort", id }`: stops that load, if it is the current one;
  - anything else is ignored.
- Replies, each with the load's `id`:
  - `progress` (`counts`, `progress`, `landing`);
  - `city` with `ok: true`, `stage`, `buildings`, `trees`, `roads`,
    `counts` (`features`, `tiles`, `missingTiles`, `volumes`, `barriers`,
    `trees`, `roads`, `buildMs`) and `groundM`, the buildings' and roads'
    buffers transferred (each once);
  - `settled` (every job tried once), then `finished` (after the retries);
  - `city` with `ok: false` and a `message` for a load that ended without
    a city (a height still missing, or no data), before its `finished`.

## Invariants & assumptions

- One load at a time; a superseded or aborted load's late replies are
  dropped, and a load superseded while the store opened never starts.
- Bad input is answered, never thrown: a target that is not finite, or a
  zoom or template `cityHeights` refuses, replies `city` `ok: false` and
  `finished` `invalid-target`; a load that throws replies `city`
  `ok: false` and `finished` `settled`.
- No city stands on invented heights: `buildCity` runs only on the
  library's deliveries, within `TERRAIN_EXTENT_M`.

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
  load only; a load superseded while the store opened; a load without a
  city saying why; a bad target, a bad zoom and a throwing load answered;
  other messages ignored.
