# terrain-relief-fetch.js - the relief region's height tiles

- Purpose: fetch a relief region's Terrarium tiles on the page's thread
  (terrain plan 2026-09-27-0605 §9 finding 4: a worker's requests are
  outside the smokes' routing, so "no request leaves the machine" would
  pass vacuously). One implementation for the terrain lab and the globe
  lab's detail region (DEC-H3).
- Public API:
  - `TILE_TIMEOUT_MS` - 30,000: a tile that never answers must not stall
    a page forever.
  - `fetchTerrariumTiles(tiles, urlTemplate, onProgress?)` - every
    `{ z, x, y }` from the template (`{z}`, `{x}`, `{y}`), each bounded by
    the timeout. Resolves to the tiles with `url` and `bytes` (an
    ArrayBuffer, or null for an HTTP error, a network error or a timeout).
    Never rejects for one tile. `onProgress(done)` after each tile.
- Invariants & assumptions: the order of the result is the order of
  `tiles`; the bytes are the file's own (decoding is the worker's).
- Tests: `terrain-relief-fetch.test.mjs` (the template, the bytes, both
  kinds of failure as gaps, the progress count, the bound).
