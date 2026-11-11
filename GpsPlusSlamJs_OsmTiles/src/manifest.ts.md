# `manifest.ts`

## Purpose

The manifest of stored tiles, the list the ODbL notice points to: which
cells the store holds and how old their data is. It is read from the tiles
themselves (an R2 listing), never written.

## Public API

- `MANIFEST_PATH` - `/osm/v3/manifest.tsv`.
- `manifestText(bucket)` - two `#` lines (the OpenStreetMap attribution and
  the column names), then one `cell<TAB>osm_base<TAB>stored_bytes` line per
  stored tile, in key order.

## Invariants & assumptions

- **Recoverable by construction.** The earlier design kept one manifest
  file that every fill rewrote: a fill killed between storing the tile and
  appending its line lost the line, and each fill's CPU grew with the store
  (a whole-file split and join at every fill). A tile in R2 is now in the
  manifest, and a fill writes nothing for it.
- The listing asks for `customMetadata`; R2 omits it from a listing
  otherwise and every `osm_base` would be empty.
- Only keys of the form `osm/v3/<valid res-7 cell>.json.gz` are listed; the
  old `manifest.tsv` object and anything else under the prefix are skipped.
- At most 100 listing pages (100,000 tiles) per manifest, so a bad cursor
  cannot loop.
- The route keeps the answer five minutes in the edge cache (`routes.ts`),
  because a listing costs one R2 operation per thousand tiles and the route
  is open to anyone.

## Examples

```ts
const text = await manifestText(env.TILES);
// # Data (c) OpenStreetMap contributors, ODbL 1.0: https://www.openstreetmap.org/copyright
// # cell	osm_base	stored_bytes
// 871fa1999ffffff	2026-11-11T09:12:34Z	3116006
```

## Tests

`manifest.test.ts`: the header and one line per tile, non-tile keys
skipped, the metadata requested, and a property that every stored tile
appears exactly once across listing pages of any size.
