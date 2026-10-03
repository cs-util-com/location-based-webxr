# globe-tile-cache.ts - releasing a carrier's tile cache

- Purpose: review 2026-10-03-1835 major 4. Outside the altitude band one
  carrier (the globe's own tiles or the relief's) is neither drawn nor
  updated, so it fetches nothing, but its tiles stayed resident: the
  globe's 64 MB sat beside the relief's down to the hold. The globe lab
  releases the inactive carrier's cache when the camera leaves the band
  on its side.
- Public API:
  - `releaseTileCache(cache)` -> bytes freed. Unloads every tile the cache
    holds; each tile's own dispose callback runs, so its GPU memory goes
    too.
    - The library unloads only part of its excess per pass and stops at
      its floor. So the floor and the caps are set to 0, every item is
      marked unused, and passes run (at most 256) until nothing more
      unloads.
    - The limits are then restored, so the carrier loads normally when it
      returns.
  - `TileCache`: the structural type of the library's `LRUCache` this
    uses. The library's typings omit `cachedBytes`.
- Invariants & assumptions: the caller decides when. The globe lab waits
  until the carrier has stayed out of the band for a hold time, and the
  carriers keep their shader program warm (`globe-warm-material.ts`),
  because a release disposes every tile's material. Call it only for a
  renderer that is not updated meanwhile. An update would mark its visible tiles used again
  and load them back.
- Tests: `globe-tile-cache.test.ts`, on the library's real `LRUCache`:
  every tile unloaded past the floor, every dispose callback run, the
  limits kept, and an empty cache left alone. In the browser:
  `labs/globe/globe-relief.smoke.spec.mjs`, on a phone viewport (the
  globe's cache released at the hold, no globe request over 5 s, both
  caches under 72 MiB).
