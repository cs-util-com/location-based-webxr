# city-data.ts - a city's data, planned and loaded once for every consumer

- Purpose: the one answer to "which Overpass tiles and which height tiles
  does a city at this place need", a loader that loads exactly that, and the
  one cached Overpass source construction (round-4 plan
  `2026-10-11-0122-globe-round-4-owner-feedback-plan.md` §5, the owner's
  question why the globe's city ran different logic from OsmDemo's). Before
  it, OsmDemo's arrival plan and the globe worker's working set derived the
  tiles twice, the source was built twice, and the globe warmed z13 heights
  from two sources while its city read z12 from one (validation finding F6).
- Public API:
  - `cityDataPlan(target, { heights, radii? })` → `{ target, heights, rings,
overpassTiles, heightUrls, window }`. Pure.
    - `heights`: `{ urlTemplates, zoom }`, Terrarium-encoded tiles at one
      zoom (0-15); several templates are a race's arms, all planned.
    - `rings`: `[{ radius, tiles }]`, inner first, each listing only the
      tiles no inner ring has (`fetchTilesForScoreWorkingSet` per radius;
      default `PROGRESSIVE_RADII`, OsmDemo's refresh rings).
    - `heightUrls`: every tile a fresh terrain field fetches for the city's
      window (`terrainWindowFor` at the target, `TERRAIN_EXTENT_M`), per
      template, by the provider's own pixel-to-tile round trip.
    - RangeError: a target that is not a latitude and longitude, a zoom
      that is not an integer 0-15, no template or one without `{z}`, `{x}`,
      `{y}`, rings that are not strictly ascending positive integers.
  - `createCityTileSource(store, { userAgent, fetchImpl? })` →
    `CachingSource(OverpassSource)`: the endpoint race behind the store.
    `userAgent` is each app's own.
  - `loadCityData(plan, options)` → `{ progress(), counts(), done,
finished, abort() }`. Options: `source`, `heightFetch` (e.g.
    `createCachingTileFetch({ store })`), `decodePng`, `onData`,
    `onProgress?(counts, progress)`, `signal?`, `firstRings?` (default 1),
    `heightDeadlineMs?` (default 20 s per height tile; `Infinity` waits),
    `retryDelaysMs?` (default 10 / 30 / 60 s), `undulationMetres?`
    (default 0: the tiles' heights, the globe relief's convention),
    `sleep?` (a test seam).
    - `onData({ stage, features, ground, groundM, tiles })`: `first` after
      the first rings (only when more rings follow), `full` after every
      ring, `retry` after a retry that brought something new. `ground` is
      `buildCity`'s input (`cityGround` on the frame at the target).
    - `finished` resolves `{ outcome: settled | aborted, counts,
missingTiles, missingHeights, elapsedMs }`, never rejects.
    - RangeError at the call: a plan with more than one height template (a
      loader reads one source), `firstRings` below 1.
- Invariants & assumptions:
  - The tiles and the heights load side by side; the tiles one at a time
    through the library's `loadTiles` (rate limits deferred, never thrown),
    so the source's own race and slot rules apply.
  - Nothing is delivered while any height is missing, MEAN-FILLED posts
    included: when some tiles of a batch answer, the field fills the
    others' posts with their mean and counts them held, so `missing` alone
    reads 0 over a failed tile (found 2026-10-11; the globe worker's own
    guard had that gap).
  - A failed or deferred tile and missing heights are asked for again after
    each retry delay; the counts move a retried job from failed to fetched.
  - Progress (`city-progress.ts`) reaches 1 once every job was tried once
    (retries do not hold a flight); it never falls; an abort freezes it.
  - The counts: a tile served from the cache is `warm` (its
    `timings.servedBy`), a height answered with `x-tile-cache: hit` is warm.
- Examples:

  ```ts
  const plan = cityDataPlan(target, {
    heights: { urlTemplates: [TERRARIUM_URL_TEMPLATE], zoom: 12 },
  });
  const load = loadCityData(plan, {
    source: createCityTileSource(store, { userAgent: "my-app (example.org)" }),
    heightFetch: createCachingTileFetch({ store }),
    decodePng: browserPngDecoder(),
    onData: (data) => draw(buildCity(data.features, data.ground)),
  });
  ```

- Tests: `city-data.test.ts`: the rings partition the working set (and a
  property over random places); the height URLs equal what a real terrain
  field fetches (z12 one source, z13 two, and a property over random places
  and zooms 11-13); the loader asks for exactly the plan's tiles and
  heights, delivers after the first ring and again with the rest, counts
  warm, fetched and failed, retries a failed and a rate-limited tile, gives
  up after its last retry, builds nothing on missing or mean-filled heights,
  gives up a hanging height at its deadline and fills it on a retry, loads
  tiles and heights side by side, stops at an abort; the source factory's
  user agent and cache.
