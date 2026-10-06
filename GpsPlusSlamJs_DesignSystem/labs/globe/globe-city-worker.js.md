# globe-city-worker.js

- Purpose: builds the globe's city off the main thread from the Osm
  library's public API only (globe city plan 2026-10-05-0040 §14, the
  owner's D-K5: the city validates that the library serves a second app).
  Loaded through the worker view (`/w/`, `serve-routes.mjs`), because the
  library imports packages by name and import maps do not apply in a
  worker.
- Protocol: `{ kind: "build", id, target: { lat, lng } }` in;
  `{ id, ok: true, buildings, trees, counts, groundM }` out (the buildings'
  typed arrays transferred), or `{ id, ok: false, message }`. A target
  that is not finite is a failed reply, never a throw.
- Steps:
  - the store: the framework's `openPersistentOsmStore` (the OPFS
    directory the arrival prefetch warms), or memory without OPFS;
  - the tiles of the target's working set (`ensureWorkingSetLoaded`, the
    tiles the prefetch warms), merged (`mergeTiles`);
  - the heights from the relief's own source and zoom (AWS Terrarium,
    z12; R13), around the target's terrain window (`terrainWindowFor`,
    `TERRAIN_EXTENT_M`), sampled at 24 m absolutely with the geoid at 0
    (heights above the ellipsoid, the relief's convention);
  - `buildCity` within the window (R12) on that field.
- Invariants & assumptions:
  - Nothing is built without heights (R3): a city on the ellipsoid would
    stand hundreds of metres underground. The reply says so instead.
  - It identifies itself to Overpass as `gps-plus-slam-globe`.
  - The lab asks only once the arrival prefetch has finished, so the two
    never download the same tile.
- Tests: through `globe-city.smoke.spec.mjs`, which routes Overpass to
  fixture buildings and every height tile to the relief's synthetic tile.
