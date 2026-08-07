# `spatial/merge-tiles.ts`

## Purpose

Combines several fetch tiles into one consistent element set. Pure and
synchronous, so it property-tests cleanly and runs identically in a worker and
in Node.

## Public API

- `mergeTiles(tiles: readonly OsmTileResult[]): MergedTiles`
- `MergedTiles`: `features` (`Map<OsmFeatureKey, OsmFeature>`), `provenance`
  (`Map<OsmFeatureKey, FeatureProvenance>`), `oldestFetchedAt?`,
  `newestFetchedAt?`, `duplicateCount`.
- `FeatureProvenance`: `{ tile, fetchedAt, sourceId }`.

## Why this exists

Fetch-tile bboxes overlap **by construction** — a hexagon's bbox is larger than
the hexagon — so the same element arrives in several tiles routinely. And those
tiles can be months apart: a user runs a session somewhere, returns weeks later
500 m away, and the new fetch has to combine with what is already stored.

**The C# reference gets this wrong, and the bug is worth knowing.**
`OsmGeoSpatialIndexer.AddOsmGeoNode` overwrites `allEntries[id]` on a duplicate
but skips re-indexing, while `GetOrAddGeometry` and the envelope lookup are
first-write-wins. So after a second tile supplies the same element, its **tags**
come from the newer tile and its **geometry** from the older one, with nothing
detecting the mix — an element whose footprint was corrected in OSM between two
fetches gets scored with new tags against an old outline. It also never consults
`version`/`timestamp`, though its data source supplies both.

## Invariants & assumptions

- **Records are TOTAL.** An element is taken whole from one tile. Never tags
  from one and geometry from another. _Property: every merged element is
  byte-identical to some input element._
- **The winner is deterministic and order-independent.** Higher `fetchedAt`
  wins; ties break on tile id. Sorting happens up front, so the result never
  depends on the caller's array order — which matters because the blob store
  gives no ordering guarantee. _Property: all permutations produce identical
  output._
- **A refetch of the SAME tile supersedes its own older copy entirely.** This is
  the one place absence means deletion, and it is sound because a tile covers a
  fixed bbox. Without it, a refresh would union with its own stale copy and a
  demolished building could never disappear — defeating §5.2's `maxAgeMs`.
  - This was a real bug, found by the order-independence property test.
  - Same tile id, same `fetchedAt`, different content is a contradictory input.
    It cannot be resolved correctly, only deterministically: prefer the richer
    result, then the smaller `sourceId`.
- **Absence is not deletion ACROSS tiles.** An element missing from a different
  newer tile means nothing — it may simply lie outside that tile's bbox.
- **Provenance survives**, so "the western half of this region is eight months
  old" is answerable and §5.2's `fetchedAt` promise keeps holding once more than
  one tile is involved.
- **`oldestFetchedAt` is the honest staleness** of the merged set: it is only as
  fresh as its stalest contributing tile.
- **Keys are `type/id`.** A bare numeric id is not unique — node 1, way 1 and
  relation 1 all exist. The C# reference used bare ids, a latent collision.

## Known limitation: no OSM `version`

`version` would be the better discriminator, but plain `out geom` does not
return it. `out meta geom` does, and could not be measured to work — two 504s,
then the run was rate-limited out (findings doc §4). `fetchedAt` ordering is
right in the overwhelming majority of cases; its blind spot is a stale mirror
serving old data under a new timestamp. **If `out meta geom` is ever cleared,
add `version` as the primary key and demote `fetchedAt` to the tie-break** — the
shape here does not need to change.

## Examples

```ts
const tiles = await Promise.all(
  fetchTilesForScoreWorkingSet(chunk).map((t) => source.fetchTile(t)),
);
const { features, provenance, oldestFetchedAt } = mergeTiles(tiles);
```

## Tests

- `merge-tiles.test.ts` — totality (including the C# bug as an explicit case),
  determinism and tie-breaking, provenance, same-tile supersession,
  cross-tile absence, and the empty/ocean-tile cases.
- `merge-tiles.property.test.ts` — over generated tile sets with deliberately
  colliding ids and timestamps: order-independence across all permutations, no
  invented or dropped elements, every output byte-identical to an input,
  provenance always pointing at a tile that really held the element, newest
  wins per element, and staleness bounded by the oldest contributing tile.
