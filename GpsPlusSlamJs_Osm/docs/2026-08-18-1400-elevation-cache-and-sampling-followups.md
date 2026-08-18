# Elevation cache & sampling — follow-ups from the DEM-composition review

Filed 2026-08-18 after the cold review of the Mapterhorn/fallback/caching
milestone (commits `38d2cf3d`, `4bb7432c`, `cf797bc3` + the review-fix
commit). Each item is real, bounded, and deliberately NOT fixed in that
milestone.

1. **DEM tile cache eviction.** `createCachingTileFetch` is unbounded in v1
   (its docs now say so). The store exposes `delete`/`keys`; a key-prefix +
   count/byte cap in the wrapper, or host-app eviction, is the fix. At quota
   the failure mode is counted (`storeFailures`) but silent to users.
2. **Negative caching for primary-coverage gaps.** Outside Mapterhorn
   coverage every new-post batch re-issues the same 404s each walk, forever
   (nothing remembers a missing tile). A session-scoped known-missing `Set`
   in `TerrariumProvider` (or gap memory in `fallbackProvider`) stops
   hammering a young free service.
3. **Half-pixel sampling convention.** `sampleTile` places sample i at
   continuous coordinate i, not i+0.5. If terrarium posts are pixel-centre
   samples (usual raster-DEM convention), the surface is shifted half a
   pixel toward the tile origin — ~6.0 m ground shift on 256-px tiles,
   ~3.0 m on 512-px, i.e. DIFFERENT shifts for the two composed sources
   where the fallback stitches them. VERIFY against the terrarium/Mapzen
   spec first; do not change on reasoning alone.
4. **Store write on the DEM critical path.** The caching fetch awaits
   encode+OPFS write before returning; a fire-and-forget persist (same
   swallow-and-count) would take it off the terrain-gate path.
5. **`TerrariumProvider` hardcodes attribution/sourceId** regardless of
   `urlTemplate` (see `../src/elevation/../..` — recorded in
   `GpsPlusSlamJs_OsmDemo/src/dem-provider.ts.md`): add optional
   `attribution`/`sourceId` to `TerrariumProviderOptions`.
