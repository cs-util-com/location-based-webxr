# globe-osm-overlay.ts

- Purpose: OpenStreetMap raster tiles drawn on the relief near the camera
  only (tour editor plan `2026-10-17-1816-tour-editor-3d-and-desktop-entry-plan.md`
  §13, G1 step 6; G0 spikes Q5, both in the primary repo's
  `GpsPlusSlamJs_Docs/docs/`). A second overlay through the library's
  `ImageOverlayPlugin` over the relief's own imagery, faded out with the
  distance, asked for only where and when the rules below allow. The OSM
  tile servers run under a usage policy (no heavy use, a visible credit
  with a link); every rule here keeps the editor a light user.
- Public API:
  - `GLOBE_OSM`: `fadeM` 300 (the fade's end and the request reach),
    `fadeStartShare` 0.7, `minZoom` 15, `requestsPerMinute` 150,
    `maxAboveGroundM` 200, `maxSpeedMps` 50 (off above these),
    `onBelowAboveGroundM` 180, `onBelowSpeedMps` 45 (on only below
    these), `rampMs` 300 (the drawn map's fade in or out), `reevaluateMs` 500,
    `reevaluateLimit` 8, `retryBackoffMs` 5000, 10000, 20000, 60000 (how
    long the failed tiles wait before they are asked for again: each
    retry that fails waits the next, then the last again; a retried tile
    that gets its map starts them over; once any map request was
    answered since the last retry, the next waits the first step at most,
    so a refusal that ended is not waited out at 60 s), `giveUpRetries` 3 (retries after
    which the relief stops waiting for a tile's map, `mapReady`),
    `requestTimeoutMs` 60000 (a map request's time limit), `gain` 1 (the
    map's darkening, `patchOsmFade`: 1 draws it as the tile server made
    it), `gainMode` "flat" (how the gain darkens, `OsmGainMode`: "flat"
    multiplies, "compress" compresses the luma), `resolution` 256, `keepRegions` 64 (released map textures kept in memory, below).
  - `osmCredit(attributionHtml)`: the framework's `OSM_TILE_ATTRIBUTION`
    as a `GlobeCredit` (`short` "OpenStreetMap", `full` its text,
    `href` its link). RangeError without an https link.
  - `osmGateLimits(limits, maxZoom)` -> `OsmGateLimits` (frozen): the
    gate's `minZoom`, `maxAboveGroundM`, `onBelowAboveGroundM`,
    `maxSpeedMps`, `onBelowSpeedMps`, the caller's over `GLOBE_OSM`'s.
    RangeError for a height or speed that is not > 0 (+Infinity opens
    it), an "on again" limit above its "off" limit, or a `minZoom` that
    is not an integer in [0, `maxZoom`]. An editor looking at a place
    from above wants the map far higher than a flight does, and its
    camera jumps across the place, so speed means nothing there.
  - `osmOverlayActive({ aboveGroundM, speedMps }, wasActive = false,
limits = GLOBE_OSM)`: the limits below are the defaults;
    with hysteresis (G1 review L2): off above 200 m over the ground or 50
    m/s; on only at or below 180 m and 45 m/s; between the two it keeps
    `wasActive`. False for anything unknown (NaN). Without the band a
    camera hovering at 200 m, or a walk at the speed limit, switched the
    map (and its requests) every frame.
  - `rampOsmOn(current, target, dtMs, rampMs = 300)`: the shader switch
    `uOsmOn` moved `dtMs / rampMs` toward `target`, landing on it, never
    past it; a step that is not finite and > 0 leaves it.
  - `createRequestCeiling(perMinute, now?)`: a sliding-minute ceiling,
    `waitMs()`, `take()`, `inLastMinute()`, `total()`. RangeError unless
    a positive integer.
  - `regionNearCamera(region, camera, { ellipsoid, groundAtM, withinM })`:
    whether a region (radians `[w, s, e, n]`) on the ground comes within
    `withinM` of the camera (ellipsoid frame): its bounding sphere, the
    centre at the sampled ground (the ellipsoid where none is loaded),
    the radius to its farthest corner. RangeError for a malformed region
    or reach.
  - `patchOsmFade(shader, uniforms)`: patches the library's layer blend
    (`tint.rgba *= layerInfo[ i ].opacity * wOpacity;`, 0.5.3) to fade
    between `uOsmFadeStart x uOsmFadeM` and `uOsmFadeM` from the camera
    and to drop with `uOsmOn` 0; false (untouched) where the line is
    missing. Before the blend it darkens the tile's colour by `uOsmGain`,
    in one of two ways picked by `uOsmFlat`: 1, a flat multiply by g,
    which keeps every contrast of the map (a road and a name against the
    land read as on the tile server's map); 0, its luma L (Rec. 709
    weights) compressed to L g / (g + (1 - g) L), the colour scaled by the
    same factor: white ends at g, a dark line keeps nearly its luma, the
    hue stays, and the map's contrasts are lowered (a name's against the
    land most). g 1 changes nothing in either.
  - `GatedOsmOverlay` (extends the library's `XYZTilesOverlay`): a lock
    (which fetches) reaches the library only through `gate(range,
level)`; a region counts as content only while locked; a release
    unlocks only what was locked; every `fetch` waits for the ceiling.
    Until the overlay is ready (`isReady`, set by its own init) a lock
    is turned away like a gated one (counted in `gatedLocks`), and
    `wanted` and `hasContent` are false, without asking the library: the
    library's plugin, registered on a relief with tiles loaded already,
    processes those tiles BEFORE it initialises its overlays (0.5.3,
    `init`), and their locks asked for a level that reads the image
    source only the overlay's init sets up (an uncaught TypeError). The
    re-evaluation picks those tiles up once the overlay is ready.
    **The keep** (`keep`, default `GLOBE_OSM.keepRegions`): a region
    whose last lock goes keeps its LOADED texture in memory (the library
    lock is held on), up to `keep` regions, the one released longest ago
    given back first; a lock of a kept region at the level it was kept at
    takes it back without the gate and without a request (at another
    level, after a change of the overlay's resolution, the kept lock is
    given back and the lock is an ordinary one: the library holds nothing
    under the new level). A region still loading, or one whose fetch
    failed (the library holds a promise for both), is given back at once,
    so a failure is never kept. `setKeep(n)` changes the keep and gives
    back what is over it at once (all at 0). `lockTextureSafe` (the
    plugin's lock) catches a failed request's rejection, where the
    library's rethrew it as an unhandled error in the console: the plugin
    records the same failure as the tile's failed state (it reads the same
    request), and the factory asks for it again from there. The error
    goes to `noteLockError(err)` (the re-evaluation's locks too): counted
    by its name, the last kept, the first of each name warned once in the
    console; an `AbortError` (the library dropping a region it no longer
    needs) is not recorded.
    `isLocked`, `wanted`, `stats()` (`locks`, `gatedLocks`,
    `lockedRegions`, `releases`: textures given back to the library, which
    drops them, so a re-visit fetches again; `keep`, `keptRegions`,
    `keptHits`: locks served from the keep; `finestLevel`; `lockErrors`:
    failed lock requests by error name; `lastLockError`: `{ name,
message }` of the last, or null). RangeError
    for a url without `{z}/{x}/{y}`, a keep that is not an integer >= 0 or
    a time limit (`timeoutMs`, default `GLOBE_OSM.requestTimeoutMs`) that
    is not finite and > 0, TypeError without a gate. **The time limit**
    runs from the moment the ceiling lets a request through to the answer's
    body: the body is read inside the limit and handed on whole (a server
    that sends the headers and then stalls would otherwise hold the
    request's slot while the library reads it), and an answer with a
    success status calls `onAnswered` (the factory's sign that the server
    is back, `retryBackoffMs`). Past the limit the request is
    aborted and fails with a `TimeoutError` (the plugin marks the tile
    failed, and the retries ask for it again); a caller's own abort stays
    an `AbortError`. Without it a server that never answers would hold a
    tile waiting for good.
  - `reevaluateGatedTiles(plugin, overlay, { limit })`: tiles whose map
    was gated when they loaded and that the gate lets through now are
    locked, fetched and drawn the way the plugin's own retry does; at most
    `limit` per call. Returns `{ started, left }`: `left` counts the tiles
    the gate would have let through beyond the limit (the next look's
    backlog).
  - `createGlobeOsmOverlay({ url, attribution, maxZoom, renderer, fadeM?,
limits?, keep?, timeoutMs?, giveUpRetries?, gain?, gainMode? })` -> `{ credit, limits,
overlay, plugin, uniforms, attach(terrain), setEnabled(on), setFadeM(m),
update(pose), stats(), coverage(), mapLoad(), mapReady(tile) }` (`gain`
    the map's darkening, `uniforms.uOsmGain`; RangeError outside (0, 1];
    `gainMode` how, `uniforms.uOsmFlat`; RangeError unless "flat" or
    "compress"):
    - `attach` registers the plugin (tile splitting off, so the relief's
      mesh is not refined for the map) on the relief's tiles and patches
      the fade into every relief material, loaded already or to come
      (each patched material gets a `GLOBE_OSM_FADE` define: its own
      program). Once only (Error on a second call). It also installs
      `mapReady` as the tiles' `isTileReady` (composed with one there
      already: both must be true), which the recorded patch of the
      library asks of every child tile (the package README).
    - `mapReady(tile)`: whether a relief tile may replace its drawn
      parent as far as the map goes. False only while the map is active
      and the overlay ready, for a tile the plugin has placed, without its
      map texture, not given up, at `minZoom` or finer, inside the
      map's content (`hasContent`: never for a tile past the street
      map's latitudes, about 85 degrees, which no request would ever map),
      and within the map's reach: the fade's end plus `lookSlackM` (25
      m), the same reach the gate asks for maps in and `coverage` counts
      in. A hold inside the fade's start only (0.7 x the fade) let
      children 0.7-1 x the fade away replace a mapped parent bare, where
      the map is still drawn at about 90 %.
      The patched traversal asks it of child tiles only, never of the
      parent's hold, so a parent already drawn stays drawn until its
      children have their map: the relief never swaps a mapped tile for
      bare finer ones. The level, content and distance are looked at once
      per look per tile: a look is taken every `reevaluateMs`, and at once
      when the camera moved `lookSlackM` from where the last was taken (a
      zoom step or a flight within a look would otherwise keep a tile that
      came into reach unheld until the next look). **Giving up**: a tile that failed
      again after `giveUpRetries` retries (default 3, RangeError unless an
      integer >= 0) is given up, and stays so through the later retries
      (each clears the failed mark while it runs) until it gets its map:
      its parent is then let go and the tile drawn bare, while the retries
      go on asking for it. Retries are counted, not time: the retry wait
      stands still while the request ceiling is full, so a full ceiling
      holds the parent however long it lasts and never gives a tile up.
    - `keep` (default `GLOBE_OSM.keepRegions`) is the overlay's keep;
      RangeError unless an integer >= 0.
    - `update({ position, aboveGroundM, speedMps, nowMs })` each frame:
      the camera (world to the tiles' frame, taken every frame after
      `attach`, the map on or off: the gate and `coverage` read it), the
      active rule with the last frame's state, the fade's switch ramped over `rampMs`
      (requests follow the rule at once; only the drawn map fades), and
      every `reevaluateMs` the gated tiles and the failed ones. **A failed
      tile is asked for again**: the library marks a tile failed on any
      rejected request (a dropped connection) and never retries by
      itself, which left that tile without its map (a bare square with
      straight edges) while it stayed loaded. While the map is on, once a
      failed tile has waited, the library's public
      `resetFailedOverlays()` releases every failed tile and locks it
      anew, so the new lock still goes through the gate and the request
      ceiling; never while the map is off. **The waits back off**
      (`retryBackoffMs`: 5, 10, 20, then 60 s and 60 s again), so an
      outage, no connection or a server refusing with 429 does not fill
      the request ceiling with retries bound to fail (the tile server's
      usage policy). A retried tile that got its map (no longer failed,
      with its texture: the reset clears the failed mark at once, so that
      alone tells nothing) starts the waits over, and a map request
      answered since the last retry cuts the next wait to the first step
      (5 s; a 60 s refusal maps again about 60 s in, not 97 s). **The reset runs after the update's re-evaluation, never
      before it**: the reset releases the regions at once, the library's
      region cache drops a released region a microtask later, and the
      library locks it anew only on the next animation frame. A
      re-evaluation in between would lock the region still cached with its
      rejected request (the tile failing again at once) and the reset's own
      lock would then hold it twice, so the tile would never heal and the
      region would leak a lock.
    - `stats()`: `enabled`, `active`, `on` (the drawn map's strength, the
      ramped shader switch), `requests`, `requestsLastMinute`,
      `unpatchedShaders` (a library change shows here), the overlay's
      `locks`, `gatedLocks`, `lockedRegions`, `releases`, `finestLevel` (the
      finest level a lock asked for, null before the first: under 15 the
      relief is too coarse for the map), and the diagnostics of how a
      drawn tile comes to lack its map: `switchedOff` (updates in which
      the map went from on to off: by the rule, or by `setEnabled(false)`
      at the next update), `unknownHeightFrames` (frames, while
      enabled, whose height over the ground was unknown: the map is off in
      them), `ceilingFullMs` (time on with the request ceiling full: no new
      tile asked for), `reevaluateBacklog` (tiles the last look left for
      the next), `cappedLooks` (looks that left some), `failedRetries`
      (times the failed tiles were asked for again), `retryWaitMs` (the
      wait before the next), `readinessAsks` (times the relief's traversal
      asked `isTileReady`: only the patched traversal asks, so 0 means an
      unpatched renderer), the overlay's `lockErrors` and
      `lastLockError`.
    - `coverage()` -> `OsmCoverage` `{ near, withMap, coarse, waiting,
failed, givenUp, unprocessed, bareUnderMap }`: the relief tiles drawn in
      the last update (`tiles.visibleTiles`, optional on
      `OsmOverlayTerrain`) that come within the map's reach of the camera
      of the last update (the fade's end plus `lookSlackM`, where the gate
      asks for the map), with their map, too coarse for it (the level picked under
      the coarsest zoom: bare relief by design), or waiting for it (gated,
      throttled, loading or failed; `failed` counts the failed ones among
      them apart, since a failed tile is asked for again only every
      `retryBackoffMs` and a check waiting for the map must not wait on it;
      `givenUp` counts those among the failed that `mapReady` no longer
      holds back; `bareUnderMap` those not given up whose parent tile has
      its map: drawn bare in place of a mapped tile, the hold's failure);
      and drawn tiles the plugin has not placed yet. All zero before `attach`, without `visibleTiles` or while
      the overlay is not ready. It walks every drawn tile: for checks and
      measurements, not each frame.
    - `mapLoad()` -> `OsmMapLoad` `{ waiting, failed, givenUp,
ceilingWaitS }`: the street map's loading state for an interface to
      show (the editor's shell): the near tiles without their map, the
      failed and the given-up ones among them, and how long the request
      ceiling holds the next request (s, rounded up to tenths; 0 when it
      has room). Read from `coverage` and the ceiling, so it walks the
      tiles too: a few times a second at most.
- Invariants & assumptions:
  - The URL and the attribution are the caller's: the framework's
    `osm-tiles.ts` (DEC-H3, held by `tests/repo-config/osm-tile-url-copies.test.js`).
    This module imports neither the framework's tile constants nor the
    Osm library (the Globe package depends on the framework only for its
    atmosphere and cloud modules, and not on the Osm library); the globe
    lab passes them.
  - A tile is asked for only when ALL hold: the overlay is ready and
    enabled, the rule is active (by default on below 180 m and 45 m/s,
    kept until above 200 m or 50 m/s; the caller's `limits` otherwise),
    the level the overlay picks for the relief tile is `minZoom` (15) or
    finer, the
    tile's region comes within the fade distance of the camera, and the
    ceiling has room. Off, nothing new is asked for and the fade's
    switch hides what is drawn.
  - **The map needs a relief tree at z15 or finer near the camera.** The
    plugin picks a region's level from its relief tile's size (one
    256 px image per tile, splitting off), and the globe's default relief
    stops at z13 there, so with the default mesh nothing is ever asked
    for (`finestLevel` 13). The denser mesh does it: `meshMaxLevel` 15
    asks for 2 tiles at eye height, 17 (the editor's about 6.5 m) for 18
    at z17 (measured 2026-10-18 over the lab's synthetic Alps, fade
    300 m). Raising the plugin's resolution instead would compose 16
    z15 tiles into each z13 tile's texture, every texture 16 times the
    memory.
  - The plugin's material wrapper re-spaces the fragment's `void main()`;
    a patch chained after it (the framework's `CloudShadow`, applied at
    `load-model`, after the plugin) must find main however it is spaced.
    An anchor error there is thrown in the render loop and stops three's
    animation loop for good (found by the smoke, fixed in
    `cloud-shadow.ts`).
  - The plugin decides a tile's overlay once, when the tile loads; the
    re-evaluation is what lets a tile gated then get its map when the
    camera comes close. It calls two private methods of the plugin
    (`_fetchTileOverlayTexture`, `_updateLayers`) and reads
    `overlayInfo`; a guard test reads the library's source for them.
  - The band's widths are a choice, not a measurement: about a tenth of
    each limit, wide enough that GPS height noise and a walking pace's
    jitter (a few metres, a few m/s) cannot cross it both ways in a
    second, narrow enough that the limits stay the plan's. A band of a
    twentieth (190 m, 47.5 m/s) would still hold against that noise; the
    verdict "no flicker" does not depend on the exact value as long as
    the band is wider than the noise of the input. The 300 ms ramp is a
    look choice, nothing measured.
  - The overlay's textures count in the relief's tile cache
    (`calculateBytesUsed`): about 256 KiB per relief tile that has one.
  - A tile that leaves the reach keeps its texture until the relief
    unloads the tile; the fade hides it. Then the texture goes to the
    keep.
  - **The keep is memory outside the relief's budget**, which the
    relief's cache no longer counts once a region's tile is gone. A kept
    region holds its region texture (256 px, about 256 KiB) and the
    library's lock on its source tile bitmap(s) (`TiledRegionImageSource`
    locks them for the region and unlocks them only when the region is
    disposed; a source bitmap is about 256 KiB): about 512 KiB a region,
    about 32 MiB at 64 and 16 MiB at 32. It exists because the relief's
    cache unloads unused tiles past its floor, and each unload released
    the tile's map region, which the library drops at once (a
    reference-counted cache with no keep).
  - **Why a keep, and its size: a measurement, 2026-10-25.** The 3D
    editor's page driven by a script (the sample tour, two passes over
    eight views at 40 and 1100 m and tilts 0, 30, 60 and 80 degrees, each
    held 6 s, then ten pans away and ten back), desktop Chromium with a
    GPU via ANGLE on a loaded machine, pixel ratio 1, the map from a fake
    tile server answering in 300 ms, a synthetic relief with 150 m hills
    answering in 150 ms. At 390 px wide (the phone's relief budget)
    without a keep 185 of 294 requests were re-fetches, the 150-a-minute
    ceiling was full for 5 s, and a tile under the camera had no map in
    74 % of one view's samples; at 1440 px (the desktop's budget) the
    relief never unloaded and nothing was re-fetched. Keeps of 0, 16, 32,
    64 and 128 at 390 px: re-fetches 192, 133, 61, 8, 8; worst minute
    158, 151, 132, 104, 104; ceiling full 11.5, 4.1, 0, 0, 0 s (64 and
    128 alike because the run re-visits only about 60 released regions; a
    wider roam would separate them). At 60 ms tile latency the same
    mechanism dominated. No phone was measured. The default stays 64; a
    caller with less memory to spare passes a smaller `keep` (the
    editor keeps 32 at phone width).
  - A level is a function of the region while the overlay's resolution
    is constant (the plugin sets it once, at the overlay's init); the
    plugin locks and releases without a level, so every release
    recomputes it, as the library itself does. A kept region remembers
    its level, so a resolution change between its release and its re-lock
    gives it back instead of serving it.
  - **The give-up and time-limit defaults: a sweep, 2026-11-03**
    (`globe-osm-map-ready.test.ts`, printed on each run). It drives the
    factory's real retry clock and `mapReady` over a modelled server for
    600 s, with `giveUpRetries` N in 2, 3, 4 and the time limit T in 30,
    60, 120 s, and reads how long the parent was held, how long a near
    tile was drawn bare, and when the map came:
    - One dropped request: every N and T hold 6 s, never bare, the map at
      5.8 s.
    - Refusals (429) for 60 s, alike for every T: N=2 holds 16 s then 81 s
      bare; N=3 37 s then 61 s; N=4 97 s and never bare; the map at 97 s.
      Refusals for 180 s: bare 202, 181 and 121 s.
    - A server answering after 45 s: T=30 never gets the map; T=60 and
      T=120 hold 45 s and map it. After 90 s: only T=120 maps it.
    - A server that never answers, held s (N=2/3/4): T=30 105/155/245,
      T=60 195/275/395, T=120 375/515/600.
    - The choice, N=3 and T=60: T must sit above the slowest answer a real
      server gives (30 s cut off the 45 s one), and 120 s would hold a
      tile for over 8 minutes against a hung server; N=3 lets a tile go
      after about 37 s of fast refusals, where N=4 covers a 60 s refusal
      window whole but holds a refused place for 97 s. What would reverse
      it: a tile server that routinely answers slower than 60 s (raise T),
      or refusal windows of a minute being the common failure (N=4). The
      server is a model; no real outage was measured.
  - The plugin's own dispose releases its regions but never disposes the
    overlay, so `createGlobeOsmOverlay` wraps it: the keep goes to 0 first
    and every kept texture is given back before the plugin lets go.
- Example:

  ```ts
  import {
    OSM_TILE_ATTRIBUTION,
    OSM_TILE_MAX_ZOOM,
    OSM_TILE_URL,
  } from "gps-plus-slam-app-framework/utils/osm-tiles";
  const osm = createGlobeOsmOverlay({
    url: OSM_TILE_URL,
    attribution: OSM_TILE_ATTRIBUTION,
    maxZoom: OSM_TILE_MAX_ZOOM,
    renderer,
  });
  osm.attach(terrain); // on the first time the setting is on
  osm.setEnabled(true);
  // each frame, after the camera moved:
  osm.update({
    position: camera.position,
    aboveGroundM,
    speedMps,
    nowMs: performance.now(),
  });
  showCredit(osm.credit);
  ```

- Tests: `globe-osm-overlay.test.ts` (the plan's limits, the credit from
  the framework's text, the active rule and unknowns, the hysteresis
  (both edges, the band kept, a property over paths that the state
  changes only at the band's edges), the ramp (steps, landing, no time,
  a property that it never overshoots), `sleepFor` rejecting at once on
  an aborted signal and leaving no listener, the factory's update
  through the band and the ramp, the sliding
  ceiling, the region test by extent and on the sampled ground, the fade
  patch against the library's own blend line (and the gain compressing
  the map's luma before the blend or multiplying flat, the factory's gain,
  its range and its mode), the
  gated lock and release
  through the library class, the finest level asked for, the fetch held
  to the ceiling, the
  re-evaluation over a fake of the plugin's state (its backlog counted)
  and a guard on its private methods, the diagnostics (a texture dropped
  only with its last lock, the switches off and the frames with an
  unknown height, the time the ceiling was full while on, the drawn tiles
  near the camera sorted by their map, the map's load (waiting, failed, the ceiling's wait), nothing read before attach or
  readiness), the keep (a released texture kept and a re-lock served
  from it past the gate, the region released longest ago given back past
  the keep, a region loading or failed never kept, 0 keeping nothing and
  a smaller keep giving back at once, the keep emptied before the
  plugin's dispose, the caller's keep through the factory, a kept region
  at another level given back and locked anew, and against the library's
  real region cache with only its fetch and dispose stubbed: one library
  lock through a release and a re-lock, the texture disposed only when
  the keep lets it go, a failed (rejected) and a loading region given
  back at once and disposed with null; red seen by breaking the keep and
  `isLoaded` in turn), the drawn tiles sorted from the camera of the last
  update with the map off, a lock before the overlay is ready turned away without
  the library (red first: the TypeError) with a guard on the plugin's
  init order in its source, the caller's limits through `osmGateLimits`,
  the active rule and the factory's frame loop and gate over a really
  initialised overlay, a failed tile asked for again once its interval
  passed with the map on, at most once per interval and never with the
  map off, a failed tile healed with one lock on its region over the
  library's own `resetFailedOverlays` and region cache (red first with
  the reset before the re-evaluation: one request only), and a failed
  lock logging no unhandled error), `globe-osm-overlay.property.test.ts` (random bursts:
  no sliding minute above the ceiling, no request dropped; over random
  tiles, places, sizes, maps, failures and heights, `mapReady` holds a tile
  back exactly when `coverage` counts it waiting and not given up),
  `globe-osm-map-ready.test.ts` (the patched library traversal itself, cut
  from the bundled build and run over a fake relief: without the hook the
  children replace the parent; with it the parent stays drawn while the
  children wait, through a full ceiling for 60 s with no retry, and is let
  go when the textures come or after the given-up retries; the look cache
  and its slack, the hold's reach against the gate's (swept over 0.75,
  0.85 and 0.97 of the fade), a tile past the map's content,
  `bareUnderMap`, the hook composed with one there already, the time limit's
  `TimeoutError` against a caller's `AbortError`, a body that stalls
  after its headers, and the give-up sweep, its "429 for 60 s" and "for
  180 s" rows mapped again within 10 s of the server's return). The Tour
  Viewer's `playwright-tests/editor3d-globe.spec.js` aborts the first
  request of a street-map tile on the real page and waits for that tile
  to be asked for again and for every near tile to carry its map. The design
  system's `labs/globe/globe-editor-blocks.smoke.spec.mjs` counts the
  requests against a fake tile server on the real page: none by default,
  z15 and finer near the camera under the ceiling with the map drawn at
  the feet and credited, none from 400 m up. The Tour Viewer's
  `editor3d-globe-osm-hold.spec.js` runs the hold on the real page at a
  phone's width (the map loaded at 1200 m, then refused while the camera
  comes to 25 m: no near tile drawn without its map, `readinessAsks` above
  0 so the patched traversal is the one running), and
  `editor3d-globe-osm-gain.spec.js` measures the gain's step at the fade's
  edge and, on a tile drawn like the street map (land, white roads, dark
  names), that the flat mode keeps its contrasts and the compression
  lowers them; the hold spec also zooms in from 3000 m to 25 m in ten
  steps and counts the tiles drawn bare where a mapped parent was
  (`bareUnderMap`, none).

- Frame cost of the hold: the traversal asks `isTileReady` once per used
  child tile per frame (on the hold e2e about 5 700 asks over its minute,
  tens a frame). Each ask is two map lookups and, once per 500 ms look per
  tile, the level and distance test; the per-frame cost was not measured on
  a phone, which is the check still open (a frame-time trace on a mid-range
  phone at street level, map on, with and without `?osmGain=`, which adds
  one dot product and a division per fragment).
