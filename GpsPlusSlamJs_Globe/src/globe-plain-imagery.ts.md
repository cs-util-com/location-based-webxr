# globe-plain-imagery.ts

- Purpose: an imagery for `createGlobeTerrain` that draws none, so every
  relief tile wears its template material's colour. For an app that wants
  the relief's shape and its own overlays (the OSM map near the camera)
  without the globe's whole-Earth imagery (`createGlobeImagery`, about
  13 MB of files that only the globe's own pages serve from
  `/globe-assets/`).
- Public API:
  - `plainImagery()` -> `TerrainImagery`: `tiling` plate carree
    (`EPSG:4326`, which the terrain's `geographicOverlay` requires) with one
    level (0); `init()` resolves; `hasContent()` is always false;
    `lockTexture()` resolves null; `releaseTexture()` does nothing;
    `getTexture()` throws an Error (the terrain plugin never asks for it
    when there is no content, so a call is a caller bug, never a blank).
- Invariants & assumptions:
  - The library's terrain plugin asks `hasContent(range, level)` before it
    locks or reads a texture (0.5.3, `TerrainRGBMeshPlugin`); false means
    no texture, no lock, and the tile's material keeps its own colour.
  - The relief's tree depth is the larger of the source's levels and the
    imagery's `tiling.maxLevel`; `meshMaxLevel` deepens it as for any
    imagery, so a plain relief still reaches z17 near the camera.
  - Other overlays (the OSM map through `ImageOverlayPlugin`) are drawn
    over the plain tiles as over any.
- Example:

  ```ts
  import { createGlobeTerrain, plainImagery } from "gps-plus-slam-globe/editor";
  const terrain = createGlobeTerrain({
    ...reliefTerrainOptions(mapterhornRelief, "desktop"),
    imagery: plainImagery(),
    template: new THREE.MeshStandardMaterial({ color: 0xd9d4c7 }),
    heightScale: 1,
    meshMaxLevel: 17,
  });
  ```

- Tests: `globe-plain-imagery.test.ts` (no content, no lock, a texture
  asked for is an error; the terrain's projection check passes; a relief
  built on it initialises and reaches its mesh level through the real
  plugin).
