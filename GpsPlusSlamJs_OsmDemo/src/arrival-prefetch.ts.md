# arrival-prefetch.ts - warm OsmDemo's caches during the globe's fly-in

- Purpose: round-5 plan
  `2026-10-01-0945-globe-round-5-fly-in-and-terrain-blend-plan.md` §3.6
  step 1 (G6) and DEC-GL5-8. At "pin", the globe lab starts this for the
  target; while the camera flies, it fetches exactly what OsmDemo will load
  at arrival (`arrival-plan.ts`) into OsmDemo's own cache, so the URL
  hand-over opens OsmDemo warm instead of waiting 15-90 s for a cold
  Overpass tile. Its progress paces the flight (the globe package's
  `flight-pace.ts`).
- Public API:
  - `startArrivalPrefetch(target, { store?, fetchImpl?, signal? })` ->
    `ArrivalPrefetch`. Never throws.
    - `store`: the cache to warm. Default: OsmDemo's OPFS store
      (`openPersistentOsmStore`). `null`: no persistent store.
    - `fetchImpl`: the network for Overpass and DEM (tests).
    - `signal`: aborts it, like `abort()`.
  - `ArrivalPrefetch`:
    - `progress()` - 0 until the cache has been listed, then
      `arrivalProgress(counts)`; 1 once settled or declined; frozen by an
      abort.
    - `done` - true once settled, declined or aborted.
    - `finished` - resolves once, never rejects, with
      `{ outcome, counts, bytesStored, elapsedMs, overpassTimings }`.
      `outcome`: `settled` (every job ended; the counts say how many
      warmed), `aborted`, `no-persistent-store`, `invalid-target`.
      `overpassTimings`: the Overpass source's own timings per fetched
      tile; `decodeMs`, `parseMs` and `storeMs` are main-thread time on the
      globe page.
    - `abort()` - cancels every request; `finished` resolves `aborted` at
      once; idempotent, and a no-op after the end.
    - `stats()` - live `{ counts, inFlight, bytesStored }`.
- Invariants & assumptions:
  - The same cache OsmDemo reads: the store and the Overpass source come
    from `osm-tile-cache.ts` (the worker's builder), the DEM bytes go
    through the library's `createCachingTileFetch` keyed by URL, as in
    `dem-provider.ts`.
  - Warm is a key that exists: one `keys()` listing, no read of a 20 MB
    entry. A listing that throws reads as "nothing warm".
  - Overpass: two tiles at a time (`DemoPipeline`'s pool), NOT speculative:
    the flight waits on it, as for OsmDemo's foreground fetch it moves
    earlier, so the source may race a cold tile at two operators. DEM: all
    tiles at once (as `TerrariumProvider` asks), each bounded by
    `PRIMARY_DEM_TIMEOUT_MS` (30 s); the body is cancelled once the cache
    has stored its clone.
  - Without OPFS it declines (`no-persistent-store`, progress 1): memory
    dies with the page at the hand-over, so warming it would cost the
    donated Overpass infrastructure about 21 MB a tile for nothing.
  - A failure (network, HTTP status, timeout) settles its job as `failed`;
    the progress counts it as settled because waiting longer warms
    nothing.
  - Main thread: it runs where it is started. On the globe page that means
    the JSON decode, the feature parse and the re-serialisation of each
    cold 21 MB tile run on the main thread (measured below). Nothing is
    kept after `finished`.
  - The hand-over navigation kills an unfinished request: OsmDemo then
    starts that tile from zero. So the globe should hand over after
    `finished` when it can (see the wiring).
- Memory and cost (`arrival-prefetch.memory.test.ts`, desktop Node 24, a
  real Overpass payload repeated to 20.2 MB, 2026-10-01; thresholds
  declared before measuring):
  - live heap above baseline at the tile's store write: about 100 MB (3
    runs: 100-101 MB) against the declared 200 MB; heap before collection
    165-216 MB;
  - retained after `finished`: 1.0-1.6 MB against the declared 10 MB;
  - stored: 24.4 MB (one 19.9 MB tile entry plus 18 DEM tiles as base64);
  - main-thread time of one tile on an idle run: decode 262 ms, parse 47 ms,
    store 295 ms. A phone is slower by a factor no test here can give; the
    report's `overpassTimings` is what a device run reads.
- The globe lab's wiring (the globe agent adds it; this module never edits
  the lab):
  - Import map, beside `three` and `3d-tiles-renderer`:

    ```json
    "h3-js": "/vendor/h3-js/dist/browser/h3-js.es.js",
    "gps-plus-slam-osm": "/osm-lib/index.js",
    "gps-plus-slam-app-framework/osm-bridge": "/fw/osm-bridge/index.js"
    ```

  - The entries are present from boot but unused until the pin: the
    prefetch's graph (the Osm library, about 1.1 MB of source, and h3-js,
    0.55 MB) loads LAZILY, by a literal dynamic import at the pin press.
    The deploy crawl follows a literal `import("...")`; the design system's
    `build-lookdev.test.mjs` fails if the globe lab's STATIC boot graph
    ever reaches the Osm library, h3-js or this module.
  - At boot (small, no dependencies):
    `import { FLIGHT_PACE_DEFAULTS, startPace, stepPace } from "/globe/flight-pace.js";`
  - At "pin", with the same `target` given to `handOverUrl`:

    ```js
    let prefetch = null;
    let gaveUp = false;
    let cancelled = false;
    const pinAt = performance.now();
    let clock = startPace(FLIGHT_PACE_DEFAULTS);
    import("/osm/arrival-prefetch.js").then(
      ({ startArrivalPrefetch }) => {
        if (!cancelled) prefetch = startArrivalPrefetch(target);
      },
      () => {
        gaveUp = true; // nothing can be warmed: do not fly slowly for it
      },
    );
    ```

  - Each frame: `const p = gaveUp ? 1 : (prefetch?.progress() ?? 0);`
    then `clock = stepPace(clock, p, now - pinAt, FLIGHT_PACE_DEFAULTS)`;
    the flight pose reads `clock.s` (the path's own easing eases its ends).
  - When the pin is cancelled (a new target, the user takes the camera):
    `cancelled = true; prefetch?.abort();`.
  - At the hand-over: `await prefetch?.finished` (bounded by the lab's own
    hold) before `location.assign(handOverUrl(...))`, because navigating
    away kills an unfinished tile and OsmDemo starts it from zero.
- Tests: `arrival-prefetch.test.ts` (a cold cache left holding every key
  OsmDemo reads; progress from 0, never falling; a warm cache costing no
  request; only the missing fetched; a dead network, an HTTP error, a
  throwing listing, no store and an invalid target never reaching the
  caller; `abort()`, an external signal and a late abort) and
  `arrival-prefetch.memory.test.ts` (the declared thresholds). The lab
  import graph is closed by the design system's `build-lookdev.test.mjs`
  ("the arrival prefetch's import map").
