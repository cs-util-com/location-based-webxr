# globe-relief-cache.ts

- Purpose: the relief's tile cache made settable and observable (tour
  editor plan `2026-10-17-1816-tour-editor-3d-and-desktop-entry-plan.md` §13, milestone
  G1 step 1c; the G0 spikes' headline finding, `2026-10-17-2320-tour-editor-3d-g0-spikes-results.md`, both in the primary repo's `GpsPlusSlamJs_Docs/docs/`). The library counts each
  relief tile's bytes as its own copy of the height grid, the imagery
  composed for it and its mesh. With 512 px Mapterhorn heights a tile
  counts about 2.4 times a 256 px AWS one, so the relief's 64 MB filled at
  49 tiles: the tree stopped refining at level 2 and drew a
  continent-sized tile 3.2 km under an eye-height camera, while sampled
  heights stayed right. Nothing on the page said so.
- Public API:
  - `RELIEF_CACHE`: `bytes256` (the budget for 256 px tiles: phone 64 MiB,
    the globe's F1 budget unchanged; desktop 256 MiB, from the sweep
    below), `floorShare` 0.75
    (the floor the library evicts down to, 48 of 64), `otherBytesPerTile`
    (the imagery's 256 x 256 RGBA and the 32 x 32 skirted mesh),
    `stallWindowMs` 2,000 (refusals closer than that are one run),
    `sustainedMs` 1,000 (a run that long reads stalled).
  - `ReliefDeviceClass`: `"phone" | "desktop"`; the app picks it (a lab
    setting, a device probe), this module never guesses.
  - `reliefTileBytes(tileDimension)`: the bytes the library counts for one
    tile: the decoded float32 grid with its one-texel border plus
    `otherBytesPerTile`. RangeError unless a positive integer.
  - `ReliefCacheBudget` `{ maxBytes, minBytes }` and
    `reliefCacheBudget(tileDimension, device)`: the 256 px budget
    scaled by the tile-bytes ratio, so the cap holds the same NUMBER of
    tiles for every format. Phone 256 px is exactly 64/48 MiB; 512 px is
    about 2.36 times that (phone 151 MiB, desktop 604 MiB). The device
    class is REQUIRED (G1 review M3): a default of "phone" put a desktop
    editor on the phone's budget without anyone choosing it. RangeError
    for a missing or unknown device class.
  - `checkReliefCacheBudget(budget)`: RangeError unless
    `0 <= minBytes <= maxBytes`, `maxBytes > 0`, all finite.
  - `ReliefCacheState`: `usedBytes`, `inUseBytes` (the bytes of the tiles
    the last traversing update used: the view's need, what a budget must
    hold; 0 before the first), `maxBytes`, `full`, `refusedRequests`
    (tiles updates wanted but could not queue), `refusedLoads` (tiles
    loaded, then dropped), `stalled` (full with a refusal since the cache last
    had room, or a run of refusals lasting `sustainedMs`).
  - `watchReliefCache(tiles, { now?, windowMs? })` -> `{ state(), dispose() }`:
    - after each update that traversed (`tiles.frameCount` moved) it adds
      the library's own `tiles.stats.refused` (reset by the library at the
      start of every traversing update);
    - it wraps the cache's `remove` to count the load step's discard: a
      tile in the cache's `loadedSet`, with no bytes counted yet, while
      the cache is full;
    - stalled when full after a refusal, until the cache is seen with
      room (after an update, a removal, or a `state()` read), or while
      refusals less than `windowMs` apart have run for `sustainedMs`;
    - `dispose()` restores `remove` and stops listening;
    - RangeError for a window that is not finite and >= 0.
- Invariants & assumptions:
  - The refusals are the library's (0.5.3), never re-derived: a guard test
    reads `TilesRendererBase.js` for the reset, the queue's count, the
    load step's discard condition and the frame counter.
  - An update a plugin skips (`doTilesNeedUpdate` false) still fires
    `update-after` with the previous count; the frame check keeps it from
    being counted twice.
  - Ordinary removals (a queued tile nobody wants, an eviction with bytes
    counted, a failed load, which is never in `loadedSet`) are not
    refusals.
  - `stalled` covers two ways a cache fails, measured in the globe lab
    (2026-10-18, a 3 km oblique view):
    - STUCK: full of tiles in use, refusals stopped, tiles missing (128
      MiB: 136 refusals, then none, 6 of 103 visible tiles never loaded).
      The library unloads unused tiles when full, so a cache that STAYS
      full holds only tiles in use: stalled until it has room. A first
      version that cleared 2 s after the last refusal read "not stalled"
      here.
    - THRASHING: far too small, the library unloads and the update
      refills and is refused again, with a moment of room every frame (8
      MiB): a run of refusals lasting a second reads stalled, full or not
      (polled, this cache was never "full"); a single burst at the cap,
      resolved by the next unload, does not. The room-latch alone never
      read stalled here.
  - A cache with room never reads stalled.
  - **`stalled` is a signal G2 must ACT on, not only show** (G1 review
    M3). A stalled relief draws a coarse tile under the camera while
    picking still answers right (the G0 headline), so a line in a debug
    panel is not enough for the editor: on `stalled` it should raise the
    cap within what the device allows (or lower the mesh level, or drop
    the OSM map), and say so when it cannot. The budget below only makes
    a stall unlikely on the views measured; nothing makes it impossible.
- The budget's measurements (globe lab, 2026-10-18; `inUseBytes` once
  settled, Munich 48.1373 N 11.5754 E, first person, the OSM map routed
  to a fake tile, a 2,048 MiB cache so nothing was refused, a GPU via
  ANGLE in headless Chromium; pixel ratio 1 unless named; MiB):
  - 1,280 x 800, mesh level 17 with the OSM map:
    - AWS, oblique (pitch -20) at 1.7 m / 30 m / 300 m / 3 km: 188.9 /
      188.9 / 191.3 / 147.1; steep (-70) at 300 m / 3 km: 47.1 / 51.7.
    - Mapterhorn, oblique: 241.7 / 241.7 / 241.7 / 188.3; steep: 108.2 /
      86.8.
  - 1,280 x 800, the default mesh, no OSM map: AWS oblique 129.9 at every
    height, steep 30.1 / 36.9; Mapterhorn oblique 212.7 / 212.7 / 212.7 /
    186.3, steep 85.9 / 85.9.
  - 1,920 x 1,080, mesh level 17 with the OSM map: AWS oblique at 1.7 m
    270.3, at 3 km 212.2 (steep 77.3); Mapterhorn oblique at 1.7 m 332.5,
    at 3 km 247.0 (steep 118.8).
  - 1,280 x 800 at pixel ratio 2 (the lab caps the ratio at 2, and the
    relief refines by drawing-buffer pixels), mesh level 17 with the OSM
    map, Mapterhorn oblique at 1.7 m: 434 (against 241.7 at ratio 1, 1.8
    times), inside the 604 MiB desktop cap with about a quarter in hand
    (G1 re-review item 2, 2026-10-18).
  - Not measured: 1,920 x 1,080 at ratio 2. Scaling its ratio-1 need
    (332.5) by the 1.8 above gives about 600 MiB, at the cap: **a stall
    is to be expected on large high-DPI windows** with Mapterhorn at mesh
    level 17, and the act-on-`stalled` rule above is what must absorb it.
    The budget is deliberately not scaled by the pixel ratio.
  - **These are the library's COUNTED bytes** (`calculateBytesUsed`: the
    height grid, the composed imagery and the mesh per tile), not the
    real GPU or JavaScript heap use, which is unmeasured. The budget
    bounds the count; what a phone or a desktop actually spends for it
    is not known.
  - Not measured: a steep first view below about 300 m (30 m at pitch -45
    and -70, 1.7 m at -70). The lab never handed those views to the
    relief (band share 0, the relief's tiles released), a lab defect
    filed with the G1 review; until it is fixed those cells are unknown.
  - What the numbers decide, and which other value would change it:
    - desktop 256 MiB holds every 1,280 x 800 view measured with a third
      in hand for AWS (191) and more than half for Mapterhorn (242 of
      604); at 1,920 x 1,080 it holds Mapterhorn (333 of 604) but NOT AWS
      at mesh level 17 with the OSM map (270), a combination no app
      plans (the denser mesh is for Mapterhorn). 192 MiB (the review's
      floor) would sit AT the 800p AWS need (191); 320 MiB would also
      hold the 1080p AWS case but gives Mapterhorn 755 MiB.
    - the phone's 64 MiB is BELOW the need measured on a desktop canvas
      (130 MiB, AWS at the default mesh, oblique), and Mapterhorn's 151
      MiB below its 186-242. A phone canvas is smaller (fewer tiles in
      view) and a phone has less memory; nothing has been measured on a
      phone, so the phone budget is an open question for the owner, not
      a measured one.
  - The watch reads the cache's live `maxBytesSize`, so a cap changed later
    (the globe lab's `reliefCacheMiB`) is what `state()` reports.
- Example:

  ```ts
  const terrain = createGlobeTerrain({
    ...options,
    tileDimension: 512,
    cache: reliefCacheBudget(512, "desktop"),
  });
  // per frame, after tiles.update():
  if (terrain.reliefCache().stalled) showWarning("relief cache full");
  ```

- Tests: `globe-relief-cache.test.ts` (the phone's 256 px budget pinned at
  64/48 MiB, the same tile count per format, no default device class,
  the desktop budget holding every measured 1,280 x 800 view (and
  Mapterhorn at 1,920 x 1,080) with a quarter in hand, the budget check;
  `inUseBytes` summed over the tiles
  the last update used and kept over a skipped update; the stall driven
  through the library's real renderer queue step and cache, lasting
  while the cache stays full, while refusals keep coming (thrashing),
  cleared by room, not raised by a refusal the same update made room for, by ordinary removals or a skipped update;
  dispose; the library guard). `globe-terrain.test.ts` drives it through
  `createGlobeTerrain`'s `cache` option and `reliefCache()`.
