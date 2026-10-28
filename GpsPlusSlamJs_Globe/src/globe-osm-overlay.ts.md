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
    `reevaluateLimit` 8, `resolution` 256, `keepRegions` 64 (released
    map textures kept in memory, below).
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
    missing.
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
    back what is over it at once (all at 0).
    `isLocked`, `wanted`, `stats()` (`locks`, `gatedLocks`,
    `lockedRegions`, `releases`: textures given back to the library, which
    drops them, so a re-visit fetches again; `keep`, `keptRegions`,
    `keptHits`: locks served from the keep; `finestLevel`). RangeError
    for a url without `{z}/{x}/{y}` or a keep that is not an integer >= 0,
    TypeError without a gate.
  - `reevaluateGatedTiles(plugin, overlay, { limit })`: tiles whose map
    was gated when they loaded and that the gate lets through now are
    locked, fetched and drawn the way the plugin's own retry does; at most
    `limit` per call. Returns `{ started, left }`: `left` counts the tiles
    the gate would have let through beyond the limit (the next look's
    backlog).
  - `createGlobeOsmOverlay({ url, attribution, maxZoom, renderer, fadeM?,
limits?, keep? })` -> `{ credit, limits, overlay, plugin, uniforms, attach(terrain),
setEnabled(on), setFadeM(m), update(pose), stats() }`:
    - `attach` registers the plugin (tile splitting off, so the relief's
      mesh is not refined for the map) on the relief's tiles and patches
      the fade into every relief material, loaded already or to come
      (each patched material gets a `GLOBE_OSM_FADE` define: its own
      program). Once only (Error on a second call).
    - `keep` (default `GLOBE_OSM.keepRegions`) is the overlay's keep;
      RangeError unless an integer >= 0.
    - `update({ position, aboveGroundM, speedMps, nowMs })` each frame:
      the camera (world to the tiles' frame, taken every frame after
      `attach`, the map on or off: the gate and `coverage` read it), the
      active rule with the last frame's state, the fade's switch ramped over `rampMs`
      (requests follow the rule at once; only the drawn map fades), and
      every `reevaluateMs` the gated tiles.
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
      the next), `cappedLooks` (looks that left some).
    - `coverage()` -> `OsmCoverage` `{ near, withMap, coarse, waiting,
failed, unprocessed }`: the relief tiles drawn in the last update
      (`tiles.visibleTiles`, optional on `OsmOverlayTerrain`) that come
      within the fade's start of the camera of the last update (where the
      map is at full strength), with their map, too coarse for it (the level picked under
      the coarsest zoom: bare relief by design), or waiting for it (gated,
      throttled, loading or failed; `failed` counts the failed ones among
      them apart, since a failed tile is never asked for again and a check
      waiting for the map must not wait on it); and drawn tiles the plugin
      has not placed yet. All zero before `attach`, without `visibleTiles` or while
      the overlay is not ready. It walks every drawn tile: for checks and
      measurements, not each frame.
- Invariants & assumptions:
  - The URL and the attribution are the caller's: the framework's
    `osm-tiles.ts` (DEC-H3, held by `tests/repo-config/osm-tile-url-copies.test.js`).
    The Globe package depends on neither the framework nor the Osm
    library; the globe lab passes them.
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
  patch against the library's own blend line, the gated lock and release
  through the library class, the finest level asked for, the fetch held
  to the ceiling, the
  re-evaluation over a fake of the plugin's state (its backlog counted)
  and a guard on its private methods, the diagnostics (a texture dropped
  only with its last lock, the switches off and the frames with an
  unknown height, the time the ceiling was full while on, the drawn tiles
  near the camera sorted by their map, nothing read before attach or
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
  initialised overlay), `globe-osm-overlay.property.test.ts` (random bursts:
  no sliding minute above the ceiling, no request dropped). The design
  system's `labs/globe/globe-editor-blocks.smoke.spec.mjs` counts the
  requests against a fake tile server on the real page: none by default,
  z15 and finer near the camera under the ceiling with the map drawn at
  the feet and credited, none from 400 m up.
