# `tile-cell.ts`

## Purpose

The one place that says what a tile cell is (an H3 resolution-7 cell, as the
OSM city source requests them) and where its file lives in the bucket.

## Public API

- `TILE_RESOLUTION` - `7`, the resolution of every stored tile.
- `parseTileCell(raw)` - the cell when `raw` is exactly 15 lowercase hex
  digits, a valid H3 cell and of resolution 7; otherwise `undefined`.
- `TILE_SCHEMA_VERSION` - the OSM package's query schema version, which
  versions the keys and every host path.
- `TILE_PREFIX` - `osm/v<schema>/`, the schema version taken from the OSM
  package's query module, so a change of the query moves every key at once.
- `FILL_PREFIX` (`fill/v<schema>/`) and `REPORT_PREFIX`
  (`report/v<schema>/`) - the request paths, versioned the same way so a
  client of another schema never fills or reports under this one's keys.
- `tileObjectKey(cell)` - `osm/v3/<cell>.json.gz`, the R2 key and the URL path.

## Invariants & assumptions

- Every path or message cell goes through `parseTileCell` before it touches
  R2 or the queue: the 15-hex shape rules out path tricks (`..`, `/`, upper
  case duplicates) before h3-js sees the string.
- The URL path and the R2 key are the same string. A custom domain still
  goes on the Worker, never on the bucket (`routes.ts.md`).

## Tests

`tile-cell.test.ts`: valid and invalid shapes, wrong resolutions, and
properties that every res-7 cell of a point is accepted, anything else of the
same length refused, and every key stays inside the tile prefix.
