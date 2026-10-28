# globe-city-worker.js

- Purpose: loads and builds the globe's city off the main thread from the
  Osm library's public API only (globe city plan 2026-10-05-0040 §14, the
  owner's D-K5: the city validates that the library serves a second app).
  Loaded through the worker view (`/w/`, `serve-routes.mjs`), because the
  library imports packages by name and import maps do not apply in a
  worker.
- Protocol (one load at a time; a new `load` or an `abort` stops the one
  before; every reply carries its `id`):
  - in: `{ kind: "load", id, target: { lat, lng }, zoom, heightsUrl?, firstRings? }`
    (`zoom` the relief's, `GLOBE_TERRAIN.maxZoom`, so the two cannot drift;
    `heightsUrl` the relief's height source, AWS Terrarium when absent;
    `firstRings` default 1); `{ kind: "abort", id }`;
  - out: `{ kind: "progress", counts, progress, landing }` after each
    settled job (`landing`: the library's `landingProgress`, the first
    delivery's jobs only, what the flight paces on, DEC-AW-1)
    (the library's `cityLoadProgress`, the counts as the pin's status line
    reads them);
  - out: `{ kind: "city", ok: true, stage, buildings, trees, roads, counts,
groundM }` per delivery (`first` after the first ring, `full`, `retry`),
    the buildings' and roads' typed arrays transferred; `counts` carries
    `features`, `tiles`, `missingTiles`, `volumes`, `barriers`, `trees`,
    `roads` and `buildMs` (the worker's `buildCity` time);
  - out: `{ kind: "settled", ... }` once every job was tried once (the
    library's `firstPass`: what the flight waits for), then
    `{ kind: "finished", outcome, counts, missingTiles, missingHeights,
elapsedMs }` after the retries; before it `{ kind: "city", ok: false,
message }` when no city was delivered (heights still missing, no tile).
    A target that is not finite, a zoom outside 1-15 or a height template
    without `{z}`/`{x}`/`{y}` is a failed reply, never a throw.
- Steps (round-4 plan 2026-10-11-0122 §5): the store (the framework's
  `openPersistentOsmStore`, or memory without OPFS); the library's
  `cityDataPlan` for the target with the relief's heights (the relief's
  own source at its zoom, R13, `globe-city-heights.js`: since G1 1d the
  template comes with the load, so a Mapterhorn relief gets a city on
  Mapterhorn heights, where a template fixed here put it on AWS heights up
  to 12 m apart in towns; one source, never OsmDemo's Mapterhorn-first
  race); the
  library's `loadCityData` through its `createCityTileSource` (the globe's
  user agent) and `createCachingTileFetch` (tiles and heights side by side,
  the first ring delivered first, a 20 s deadline per height tile, retries
  after 10, 30 and 60 s); `buildCity` within the terrain window (R12) with
  the roads, on each delivery.
- Invariants & assumptions:
  - The warm-up and the build are one load, so they read the same tiles and
    the same heights by construction (validation finding F6).
  - Nothing is built while any height is missing, mean-filled posts
    included (the library's guard; the previous worker counted only
    `missing`, which reads 0 over a failed tile whose neighbours answered).
  - The data parse (a cold res-7 tile is about 21 MB of JSON) runs here,
    never on the page's main thread.
  - It identifies itself to Overpass as `gps-plus-slam-globe`.
- Tests: through `globe-city.smoke.spec.mjs` (fixture buildings, walls and
  roads routed, the relief's synthetic heights) and
  `globe-arrival.smoke.spec.mjs` (the load as the pin's warm-up); the
  loader itself through the library's `city-data.test.ts`.
