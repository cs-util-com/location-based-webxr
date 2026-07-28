# `source/osm-data-source.ts`

## Purpose

The `OsmDataSource` seam — the abstraction that keeps the Overpass decision
reversible, and the only interface everything downstream consumes.

## Public API

- `OsmDataSource` — `{ attribution, sourceId, fetchTile(tile, signal?) }`.
- `OsmTileResult` — `{ tile, features, fetchedAt, sourceId, schemaVersion, skipped, osmBaseTimestamp? }`.
- `OSM_ATTRIBUTION` — `"© OpenStreetMap contributors"`.

## Invariants & assumptions

- **Everything downstream depends on this interface, never on `OverpassSource`.**
  That is what makes swapping in a self-hosted instance, a PMTiles build, or a
  pre-baked server index a configuration change rather than a rewrite. Given
  what the measurements in `../testdata/README.md` show about public-instance
  latency, that escape hatch is not hypothetical.
- **`OsmTileResult` is structured-cloneable and JSON-serialisable.** It crosses
  a storage boundary (the blob store) and, in the consumer's bridge, a Web
  Worker boundary. A round-trip test pins this.
- **`fetchedAt` describes when the DATA was retrieved, not when it was read.**
  A cached tile keeps its original timestamp, so a consumer showing "OSM data
  from March 2026" is telling the truth.
- **`attribution` lives on the source, not as a module constant**, because a
  self-hosted or blended source may owe different credit. Rendering it is an
  ODbL obligation, not a courtesy.
- `schemaVersion` travels with the result so a cache can reject non-equivalent
  entries even if its key scheme changes.
- `skipped` is always present. Parser rejections are counted, never silently
  discarded.

## Implementations

`OverpassSource` (network), `FixtureSource` (tests/offline), `CachingSource`
(decorator over any of them).

## Tests

`fixture-source.test.ts` proves interchangeability: the same assertions pass
through a fixture source and through the caching decorator, and a result
survives a JSON round-trip unchanged.
