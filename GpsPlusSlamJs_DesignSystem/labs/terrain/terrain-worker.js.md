# terrain-worker.js: decode, mosaic, resample, precompute

- Purpose: the terrain lab's module Worker (terrain plan 2026-09-27-0605 §4
  "Data" and "Precompute", §9 findings 3-5 and 14). It turns the tile bytes
  the page fetched into the grids the shader reads.
- Pipeline, all reused where the repo already had it:
  - decode each tile with the Osm library's `browserPngDecoder` (colour
    management and premultiplication off: one red step is 256 m) and
    `toElevationTile`, through `/osm-lib/elevation/terrarium.js`;
  - stitch with `terrain-mosaic.js`, projected by the library's
    `toWorldPixel`;
  - resample onto the metric ENU grid with OsmDemo's `buildHeightfieldData`
    (`/osm/heightfield.js`) in the library's `enuFrameAt` frame, then make it
    datum-relative with OsmDemo's `terrainTextureFrom`
    (`/osm/terrain-texture.js`);
  - `terrain-precompute.js` for the gradient, the relief and the spread;
    the sky view afterwards, in its own message.
- Protocol (one build at a time; `id` echoes back, the page ignores stale
  ones):
  - in: `{ type: "build", id, spec, tiles: [{ z, x, y, bytes }], svf }`;
    `spec` is `fieldSpec(place)` plus `reliefSigmaM` and `detailSigmaPosts`;
    `bytes` is an ArrayBuffer, or null for a tile that failed to load;
    `svf` is `{ directions, steps }`.
  - out: `{ type: "relief", id, side, extentM, spacingM, datum, hasData,
missing, total, reliefM, missingTiles, decodeFailures, decodedMs,
reliefMs, fields }`, the fields transferred (`height`, `gx`, `gy`,
    `relief`, `reliefStd`, `reliefSmall`, `valid`); then
    `{ type: "svf", id, svf, ms }` when `svf.directions > 0` and there is
    data; or `{ type: "error", id, message }`.
- Invariants & assumptions:
  - It never fetches (plan §9 finding 4): a worker's requests would escape
    the smoke's routing and make "no request leaves" pass vacuously.
  - Route URLs only, never bare specifiers: import maps do not apply in a
    worker. The deploy crawl refuses a bare one (`build-lookdev.mjs`), and
    the root test `atmosphere-served-imports.test.js` keeps the served Osm
    and OsmDemo modules free of them.
  - A failed or undecodable tile is a gap: its posts are filled by the
    heightfield from the mean of the rest (never 0 m) and marked invalid,
    which the shader draws as a hatch.
- Tests: none in Node (it is wiring over browser APIs); its pieces are
  unit-tested, and `terrain.smoke.spec.mjs` runs it on real and synthetic
  tiles, including a failing tile and every tile failing.
