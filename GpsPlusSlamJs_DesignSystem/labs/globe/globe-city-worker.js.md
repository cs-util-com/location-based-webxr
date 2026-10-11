# globe-city-worker.js

- Purpose: builds the globe's city off the main thread from the Osm
  library's public API only (globe city plan 2026-10-05-0040 §14, the
  owner's D-K5: the city validates that the library serves a second app).
  Loaded through the worker view (`/w/`, `serve-routes.mjs`), because the
  library imports packages by name and import maps do not apply in a
  worker.
- Protocol: `{ kind: "build", id, target: { lat, lng }, zoom }` in
  (`zoom` the relief's, `GLOBE_TERRAIN.maxZoom`, so the two cannot drift);
  `{ id, ok: true, buildings, trees, counts, groundM }` out (the buildings'
  typed arrays transferred), or `{ id, ok: false, message }`. A target
  that is not finite is a failed reply, never a throw.
- Steps:
  - the store: the framework's `openPersistentOsmStore` (the OPFS
    directory the arrival prefetch warms), or memory without OPFS;
  - the tiles of the target's working set (`ensureWorkingSetLoaded`, the
    tiles the prefetch warms), merged (`mergeTiles`);
  - the heights from the relief's own source and zoom (AWS Terrarium at
    the zoom the lab passes; R13), around the target's terrain window
    (`terrainWindowFor`, `TERRAIN_EXTENT_M`), sampled at the zoom's pixel
    at the target's latitude (about 26 m at z12, never under
    `TERRAIN_SPACING_M`) absolutely with the geoid at 0 (heights above the
    ellipsoid, the relief's convention). The library's sampler and the
    relief's place a sample half a pixel apart (validation finding F11),
    so on slopes the city's ground and the relief's differ by the rise
    over half a pixel;
  - `buildCity` within the window (R12) on that field.
- Invariants & assumptions:
  - Nothing is built without heights, nor with ANY height missing (R3,
    r790 milestone review F5): the field fills a gap with the window's
    mean, which would stand buildings tens of metres (kilometres in the
    Alps) off the ground. The reply says how many were missing.
  - It identifies itself to Overpass as `gps-plus-slam-globe`.
  - The lab asks only once the arrival prefetch has finished, so the two
    never download the same tile.
- Tests: through `globe-city.smoke.spec.mjs`, which routes Overpass to
  fixture buildings and every height tile to the relief's synthetic tile.
