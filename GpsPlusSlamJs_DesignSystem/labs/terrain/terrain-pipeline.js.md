# terrain-pipeline.js: decoded tiles to the metric grid

- Purpose: the terrain lab's data chain (terrain plan 2026-09-27-0605 §4
  "Data", §9 finding 5): stitch the decoded Terrarium tiles
  (`terrain-mosaic.js`), resample them onto the ENU grid with OsmDemo's
  `buildHeightfieldData`, make the grid datum-relative with OsmDemo's
  `terrainTextureFrom`, and mark the posts that had no data.
- Public API:
  - `reliefField({ decoded, range, spec, deps })` -> `Promise<{ side,
height, valid, datum, hasData, missing, total, reliefM, missingTiles }>`.
    - `decoded`: the library's `ElevationTile`s (256 px); `range`: the tile
      range they cover; `spec`: `fieldSpec(place)`.
    - `deps`: `{ toWorldPixel, enuFrameAt, buildHeightfieldData,
terrainTextureFrom }`, injected: the worker passes the served modules
      (`/osm-lib/`, `/osm/`), the test the same TypeScript sources.
    - `height`: datum-relative metres, row-major, row 0 at the SOUTH edge;
      `valid`: 1 for data, 0 where the heightfield filled the post from the
      mean (a missing tile).
    - Throws when the heightfield's side is not `spec.side` (the page sizes
      its textures from `spec.side`; another side would be read with the
      wrong row stride).
    - No tile at all: `hasData` false, `height` all 0 and `valid` all 0.
- Invariants & assumptions:
  - **The ENU frame is equirectangular** (the Osm library's `enuFrameAt`):
    one longitude scale, `cos(37.9°)`, for the whole region, and 111 320 m
    per degree of latitude. The residual, as a tolerance input for T2's
    style C (the Blue Marble far field must land on the same ground):
    - east-west: a post's drawn distance from the central meridian is too
      long by 1.58 % at the drawn region's north edge (+128 km) and too
      short by 1.54 % at its south edge; 1.68 % and 1.64 % at the padded
      field's edges (+-136 km);
    - so a drawn corner sits about 2.0 km (drawn region) or 2.3 km (field)
      east or west of its true place; nothing is off along the centre row;
    - north-south: 111 320 m per degree against the WGS84 meridian's
      110 995 m at 37.9° N, 0.29 % too long, 375 m at the region's edge;
    - the Earth's curvature is ignored too (a 256 km square sags 1.3 km,
      plan §4).
    - For the lab these are invisible; for a blend with imagery sampled on
      the ellipsoid (style C), a feature near a corner can be misregistered
      by about 2 km: a fifth of a Blue Marble level-3 pixel (about 10 km,
      research §3, unverified) and about half a level-4 one. Compare against the imagery's pixel before
      choosing C's tolerance.
- Tests: `terrain-pipeline.test.mjs` runs the real modules (TypeScript
  loaded through a resolve hook that maps `./x.js` to `./x.ts`) on synthetic
  tiles holding a plane in world pixels, and holds eight posts' texels
  (corners, edges, centre, one arbitrary) and the datum to the Web Mercator
  formula written out in the test; a missing tile's posts invalid; a
  mismatched side refused; no tiles at all.
