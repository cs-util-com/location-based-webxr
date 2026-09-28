# terrain-mosaic.js: the tile set and the seamless mosaic

- Purpose: say which Terrarium tiles a region needs, and stitch the decoded
  tiles into ONE elevation raster, so a sample between the last pixel of one
  tile and the first of the next interpolates like anywhere else (terrain
  plan 2026-09-27-0605 §4 "Data", §9 findings 5 and 15).
- Public API:
  - `tileRangeFor(points, tileSize)` -> `{ x0, x1, y0, y1 }` (inclusive):
    the tiles under a set of world pixels, widened by one pixel so a
    boundary sample's neighbour is included. Throws `RangeError` for no
    points or a non-finite one.
  - `regionTiles({ zoom, extentM, tileSize? }, { toLatLng, toWorldPixel })`
    -> `[{ z, x, y }]`, row by row: every tile under the square `±extentM`
    around the frame's origin.
  - `createMosaic(range, tiles, tileSize)` -> `{ originX, originY, width,
height, data, missingTiles }`: `data` is a Float32Array with NaN where
    no tile arrived. Throws `RangeError` for a tile of another size.
  - `sampleMosaic(mosaic, worldX, worldY)` -> metres or `undefined`:
    bilinear, each pixel's value at its CENTRE (`i + 0.5`); `undefined`
    outside the raster or where any of the four pixels has no data.
  - `mosaicProvider(mosaic, toWorld)` -> an `ElevationProvider`-shaped
    `{ sourceId, elevationAt(positions) }`, which is what OsmDemo's
    `buildHeightfieldData` reads.
- Invariants & assumptions:
  - Dependency-free: the Web Mercator maths is the Osm library's
    `toWorldPixel`, injected by the worker (plan §9 finding 1), so the
    formula exists once and this file runs under `node --test`.
  - The frame is equirectangular (`enuFrameAt`), so a square's four corners
    bound it in Mercator too.
  - No data is `undefined`, never 0 m: sea level shaped like an outage reads
    as terrain. The heightfield fills those posts from the mean and the
    worker marks them for the shader's hatch.
  - Why not the library's `TerrariumProvider`: it samples each tile alone
    and clamps at the edge, a one-pixel flat strip and a step at every
    boundary, which the slope boost turns into a line across the relief.
- Example: `const m = createMosaic(range, tiles, 256); sampleMosaic(m, wx, wy)`.
- Tests: `terrain-mosaic.test.mjs`: the one-pixel widening, a single-tile
  footprint, refusals, the region's row-major tile list, a plane reproduced
  exactly across tile boundaries (no seam), a pixel's own value at its
  centre, no data for a missing tile and at its border, outside the raster,
  a wrong tile size, and the provider's batch through the injected
  projection.
