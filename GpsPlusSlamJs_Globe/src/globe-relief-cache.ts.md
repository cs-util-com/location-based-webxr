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
    the globe's F1 budget unchanged; desktop 128 MiB), `floorShare` 0.75
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
    `reliefCacheBudget(tileDimension, device = "phone")`: the 256 px budget
    scaled by the tile-bytes ratio, so the cap holds the same NUMBER of
    tiles for every format. Phone 256 px is exactly 64/48 MiB; 512 px is
    about 2.36 times that. RangeError for an unknown device class.
  - `checkReliefCacheBudget(budget)`: RangeError unless
    `0 <= minBytes <= maxBytes`, `maxBytes > 0`, all finite.
  - `ReliefCacheState`: `usedBytes`, `maxBytes`, `full`, `refusedRequests`
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
  64/48 MiB, the same tile count per format, desktop twice phone, room for
  the spike's 197 MiB eye-height use, the budget check; the stall driven
  through the library's real renderer queue step and cache, lasting
  while the cache stays full, while refusals keep coming (thrashing),
  cleared by room, not raised by a refusal the same update made room for, by ordinary removals or a skipped update;
  dispose; the library guard). `globe-terrain.test.ts` drives it through
  `createGlobeTerrain`'s `cache` option and `reliefCache()`.
