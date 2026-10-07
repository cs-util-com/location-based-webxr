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
      abort. It can read 1 a few microtasks before `done` turns true (the
      last job settles, then the run finishes): treat 1 as "the wait is
      over" and `done` or `finished` as "the report is ready".
    - `done` - true once settled, declined or aborted.
    - `finished` - resolves once, never rejects, with
      `{ outcome, counts, bytesStored, writeFailures, elapsedMs,
overpassTimings }`. `outcome`: `settled` (every job ended; the
      counts say how many warmed), `aborted`, `no-persistent-store`,
      `store-unwritable` (the store did not keep a probe value),
      `invalid-target`. `writeFailures`: writes the store failed, thrown or
      counted in its `stats.errors`.
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
  - Overpass: one tile at a time, in plan order (the tile under the target
    first), NOT speculative: the flight waits on it, as for OsmDemo's
    foreground fetch it moves earlier (`DemoPipeline`'s
    `FETCH_CONCURRENCY` 1), so the source's two slots race that one tile at
    two operators, and only one 21 MB tile is parsed in memory at once. DEM: all
    tiles at once (as `TerrariumProvider` asks), each bounded by
    `PRIMARY_DEM_TIMEOUT_MS` (30 s); the body is cancelled once the cache
    has stored its clone.
  - Without OPFS it declines (`no-persistent-store`, progress 1): memory
    dies with the page at the hand-over, so warming it would cost the
    donated Overpass infrastructure about 21 MB a tile for nothing.
  - A store that exists but does not keep a value declines too
    (`store-unwritable`): a put, get and delete of a tiny probe key comes
    first, because the OPFS store swallows a failed write by design. A
    write that fails later (quota) is counted in `writeFailures`, and its
    job reads as failed, not warmed.
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
  real Overpass payload repeated to 20.2 MB per tile, at a place whose
  arrival needs three tiles; thresholds declared before measuring; 3 runs,
  2026-10-02):
  - what is measured: `heapUsed + arrayBuffers` (the response bytes live
    outside the JS heap), the PEAK above the baseline with garbage
    included, sampled at every fetch, every write and every free
    millisecond;
  - the usual race (one operator answers, the other is cancelled):
    peak 216-253 MB against the declared 300 MB; live heap at a tile's
    store write 136-177 MB;
  - the worst race (both operators answer at once, so both 21 MB bodies are
    decoded): peak about 414 MB, OVER the 300 MB declared for the usual
    case; reported, not asserted;
  - retained after `finished`: about 1-2 MB against the declared 10 MB;
  - stored: 62.6 MB (three 19.9 MB tile entries plus 12 DEM tiles as base64);
  - main-thread time per tile: decode 141-705 ms, parse 20-247 ms, store
    214-798 ms (a loaded machine; the low ends are the idle figures).
  - THE PHONE RISK IS OPEN: a phone browser kills a tab far below a
    desktop's memory, and the globe page already holds its own imagery and
    WebGL buffers. Whether a 250-400 MB transient fits beside the globe on
    a phone is not known; only a device run (the report's
    `overpassTimings`, and the browser's memory tools) can say.
- The globe lab's wiring (added in the lab itself when it is wired; this
  module never edits the lab):
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
  - At "pin", for the flight's `target`:

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
  - At the landing nothing is navigated any more: the globe's page
    hand-over to OsmDemo was removed (globe city plan 2026-10-05-0040
    §12.5 C6), and the globe builds its own city from the same store once
    `prefetch.finished` has settled (so the two never download one tile
    twice). The city reads the Overpass tiles this module warms, but its
    z12 heights are not part of this plan (validation finding F6).
- Tests: `arrival-prefetch.test.ts` (a cold cache left holding every key
  OsmDemo reads; progress from 0, never falling; a warm cache costing no
  request; only the missing fetched; a dead network, an HTTP error, a
  throwing listing, no store and an invalid target never reaching the
  caller; `abort()`, an external signal and a late abort; one Overpass
  tile in flight at a time, asked in plan order, at a three-tile place; a
  store that fails the write probe declines; a write failure makes its job
  failed) and
  `arrival-prefetch.memory.test.ts` (the declared thresholds). The lab
  import graph is closed by the design system's `build-lookdev.test.mjs`
  ("the arrival prefetch's import map").
