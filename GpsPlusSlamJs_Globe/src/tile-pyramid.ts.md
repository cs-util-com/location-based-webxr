# tile-pyramid.ts - the EPSG:4326 XYZ tile layout

- Purpose: globe plan 2026-09-26-0539 §7.4. The layout the committed Blue
  Marble pyramid is cut to, matching 3d-tiles-renderer's EPSG:4326 tiling
  with a plain `{y}` URL template (the library then flips y).
- Public API:
  - `tileBBox4326(x, y, z)` → `{ west, south, east, north }` in degrees.
    Level z has 2·2^z columns and 2^z rows of 180/2^z-degree tiles; x counts
    east from 180°W, y counts south from 90°N. `RangeError` outside a level.
  - `wmsBBox(box)` → the WMS 1.3.0 EPSG:4326 BBOX, latitude first
    (`south,west,north,east`).
  - `pyramidTiles(maxLevel)` → every `{ x, y, z }` from level 0 up.
- Invariants & assumptions: the layout was checked on the globe itself
  (Europe, Africa and Arabia in place, north up, no seams).
- Tests: `tile-pyramid.test.ts` (level 0 and 1 boxes, the WMS order, 2·4^z
  tiles per level) and `.property.test.ts` (the tiles of any level cover the
  globe exactly; any point falls in exactly one tile).
