# globe-height-keeper.ts

- Purpose: keeps the relief's decoded heights past their tiles (owner
  decision 2026-10-04, DEC-N1 in the primary repo's
  `2026-10-04-2023-globe-next-steps-and-framework-release-plan.md`). The
  owner zoomed out and back in and saw the elevation load again: leaving
  the band drains the relief, and the library's terrain plugin frees a
  decoded elevation grid (reference-counted, one per source tile) with its
  last tile, so a return fetched and decoded every height tile again.
- Public API:
  - `installHeightKeeper(plugin, { maxBytes, sourceOf? })` ->
    `{ stats(), dispose() }`. It wraps the plugin's `_releaseGrid` so the
    grid a tile releases gets one extra lock (taken before the library's
    release, so the count never reaches zero). Kept grids are held newest
    first within `maxBytes`; the oldest are given back to make room, and a
    grid released again moves to the newest place. With `maxBytes` 0 it
    keeps nothing.
    - `stats()`: `kept` and `keptBytes` (the grids held now) and `evicted`
      (given back to make room since installation).
    - `dispose()` gives every kept grid back.
    - TypeError if the plugin lacks `_releaseGrid` or a `_gridCache` with
      `lock`, `release` and `get`; RangeError for a budget that is not
      finite and >= 0.
  - `librarySourceOf(tile)`: the tile's grid key `[x, y, level]`, which the
    library stores under a module-private symbol named "SOURCE_TILE" and
    this finds by its description; undefined when absent or not an array.
- Invariants & assumptions:
  - Only the decoded heights (the grid's Float32Array, about 266 KB per
    258 x 258 source grid) are kept, on the CPU. The tile's imagery, mesh
    and GPU copies go as before, so a return builds those again.
  - The kept bytes are outside the relief's tile cache accounting
    (`GLOBE_TERRAIN.cacheBytes`); the budget (`keepHeightsBytes`, 16 MiB by
    default) is their own ceiling.
  - It touches private members of 3d-tiles-renderer 0.5.3, guarded by a
    test that reads the library source (the symbol, the lock at parse, the
    release in `_releaseGrid`, and `disposeTile` calling it).
- Example:

  ```ts
  const keeper = installHeightKeeper(plugin, { maxBytes: 16 * 2 ** 20 });
  // ...a drain releases tiles; their grids stay locked...
  keeper.stats(); // { kept: 45, keptBytes: 11_960_000, evicted: 0 }
  ```

- Measured (the globe lab's `globe-handover.smoke.spec.mjs`, synthetic
  heights, SwiftShader): a return into the band after the relief's drain
  requested 1 height tile with the keeper, against 30 without it; 45 grids
  (11.4 MiB) were kept, none given back.
- Tests: `globe-height-keeper.test.ts` (a kept grid makes a return fetch
  nothing, one lock per grid, the budget gives back the oldest, a reused
  grid moves to the newest place, the zero budget, dispose, the refusals,
  the symbol lookup, and the library guard); `globe-terrain.test.ts` (the
  terrain installs it with the 16 MiB default and exposes its counters).
