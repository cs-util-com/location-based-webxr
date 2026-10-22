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
    `reevaluateLimit` 8, `resolution` 256.
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
    `isLocked`, `wanted`, `stats()`. RangeError for a url without
    `{z}/{x}/{y}`, TypeError without a gate.
  - `reevaluateGatedTiles(plugin, overlay, { limit })`: tiles whose map
    was gated when they loaded and that the gate lets through now are
    locked, fetched and drawn the way the plugin's own retry does; at most
    `limit` per call.
  - `createGlobeOsmOverlay({ url, attribution, maxZoom, renderer, fadeM?,
limits? })` -> `{ credit, limits, overlay, plugin, uniforms, attach(terrain),
setEnabled(on), setFadeM(m), update(pose), stats() }`:
    - `attach` registers the plugin (tile splitting off, so the relief's
      mesh is not refined for the map) on the relief's tiles and patches
      the fade into every relief material, loaded already or to come
      (each patched material gets a `GLOBE_OSM_FADE` define: its own
      program). Once only (Error on a second call).
    - `update({ position, aboveGroundM, speedMps, nowMs })` each frame:
      the gate's camera (world to the tiles' frame), the active rule with
      the last frame's state, the fade's switch ramped over `rampMs`
      (requests follow the rule at once; only the drawn map fades), and
      every `reevaluateMs` the gated tiles.
    - `stats()`: `enabled`, `active`, `requests`, `requestsLastMinute`,
      `unpatchedShaders` (a library change shows here), `locks`,
      `gatedLocks`, `lockedRegions`, `finestLevel` (the finest level a lock
      asked for, null before the first: under 15 the relief is too coarse
      for the map).
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
    unloads the tile; the fade hides it.
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
  re-evaluation over a fake of the plugin's state and a guard on its
  private methods, a lock before the overlay is ready turned away without
  the library (red first: the TypeError) with a guard on the plugin's
  init order in its source, the caller's limits through `osmGateLimits`,
  the active rule and the factory's frame loop and gate over a really
  initialised overlay), `globe-osm-overlay.property.test.ts` (random bursts:
  no sliding minute above the ceiling, no request dropped). The design
  system's `labs/globe/globe-editor-blocks.smoke.spec.mjs` counts the
  requests against a fake tile server on the real page: none by default,
  z15 and finer near the camera under the ceiling with the map drawn at
  the feet and credited, none from 400 m up.
