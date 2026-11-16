# globe-city-worker.ts

## Purpose

The globe editor's city worker shell: the Globe package's worker core
(`createCityWorkerCore` from `gps-plus-slam-globe/city-worker`) wired to
the Osm library's city API, to the browser's persistent tile store
(`openPersistentOsmStore`, an in-memory store where none opens), to the
project's tile host (`OSM_TILES_BASE_URL` of the Osm library, passed as
the core's `staticTilesBaseUrl`) and to the worker's `postMessage`. The
data parse and the city's build run here, off the page's main thread.

## Public API

- `CITY_WORKER_USER_AGENT` - how the editor identifies itself to the
  Overpass operators.
- The worker's messages are the core's: `{ kind: "load", id, target,
zoom, heightsUrl?, firstRings? }` and `{ kind: "abort", id }`; replies
  `progress`, `city`, `settled`, `finished` (see the core's sidecar in the
  Globe package).

## Invariants & assumptions

- Made by `editor3d-globe.ts` as
  `new Worker(new URL("./globe-city-worker.ts", import.meta.url), { type: "module" })`,
  so Vite bundles it with its imports.
- All logic and validation are the core's; this file only wires it. The
  build window (the delivery's loaded-tile box) and the cosmetic woods
  switch (off until objects M2b) are set in the core too.
- Each city tile is asked of the tile host first (the library's
  `StaticTileSource`): a 200 is the tile, and the Overpass race is never
  asked for it; a 404 asks the host to fill it, and a fill the host
  accepts with nothing queued ahead is waited for up to 60 s. A refused
  fill, fills queued ahead, an error or a timeout hand the tile to the
  race at once. After a refusal no fill is asked for 10 minutes (stored
  tiles are still read); after no answer at all (a network error or a
  timeout) the host is not asked anything for 10 minutes. Both hold
  within one load only: the core builds a new source for each load, so
  the next load asks the host again.
- The host is always on, with no switch (OsmDemo's `tiles=off`). The
  worker's deps are fixed when it starts and it cannot read the page's
  URL, so a switch would need a new field in the core's load message, for
  a debugging aid OsmDemo already offers on the same library code; the
  library's own fallback covers a host that is down.

## Examples

```ts
const worker = new Worker(new URL("./globe-city-worker.ts", import.meta.url), {
  type: "module",
});
worker.postMessage({ kind: "load", id: 1, target: { lat, lng }, zoom: 12 });
```

## Tests

`globe-city-worker.test.ts` (the real shell, core and library, only
`fetch` stubbed): the shell answers a load whose target is no place with
the core's refusal; a city tile is asked of the tile host before the
Overpass race, and on a 404 the fill is asked and refused before the race
takes it; a stored tile (200) is read from the host alone. The full path
(the host answering 404, Overpass and heights routed) runs in
`../../playwright-tests/editor3d-globe-buildings.spec.js`, which also
checks the host was asked.
