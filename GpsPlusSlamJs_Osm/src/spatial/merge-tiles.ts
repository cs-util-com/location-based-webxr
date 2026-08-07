/**
 * Merges several fetch tiles into one consistent element set.
 *
 * Fetch-tile bboxes overlap by construction — a hexagon's bbox is larger than
 * the hexagon — so the same element arrives in several tiles routinely. Those
 * tiles can be months apart: a user runs a session somewhere, comes back weeks
 * later 500 m away, and the new fetch has to combine with what is already
 * stored. This module is where that combining happens, and it is pure so that
 * it can be property-tested and run identically in a worker and in Node.
 *
 * **The failure mode being designed against, taken from the C# reference:**
 * `OsmGeoSpatialIndexer.AddOsmGeoNode` overwrites the element on a duplicate id
 * but skips re-indexing, while its geometry and envelope lookups are
 * first-write-wins. So tags come from the newest tile and geometry from the
 * oldest, with nothing detecting the mix — an element whose footprint was
 * corrected in OSM between two fetches gets scored with new tags against an old
 * outline. The reference also never consults `version`/`timestamp` even though
 * its data source supplies them.
 *
 * @see merge-tiles.ts.md
 */

import type { OsmFeature, OsmFeatureKey } from "../model/osm-feature.js";
import { featureKey } from "../model/osm-feature.js";
import type { OsmTileResult } from "../source/osm-data-source.js";

/** Where a merged element came from. */
export interface FeatureProvenance {
  /** The fetch tile whose copy won. */
  readonly tile: string;
  /** When THAT tile was fetched — not when the merge ran. */
  readonly fetchedAt: number;
  readonly sourceId: string;
}

export interface MergedTiles {
  /** One record per element, each taken WHOLE from a single source tile. */
  readonly features: ReadonlyMap<OsmFeatureKey, OsmFeature>;
  readonly provenance: ReadonlyMap<OsmFeatureKey, FeatureProvenance>;
  /**
   * Oldest contributing tile's `fetchedAt`.
   *
   * The honest staleness of the merged set: it is only as fresh as its stalest
   * tile, and reporting the newest would let a just-fetched neighbour disguise
   * year-old data.
   */
  readonly oldestFetchedAt?: number;
  readonly newestFetchedAt?: number;
  /** Elements that appeared in more than one tile, counted once per extra copy. */
  readonly duplicateCount: number;
}

/**
 * Combines tiles into one element set, newest copy winning.
 *
 * Rules, each pinned by a test in `merge-tiles.test.ts`:
 *
 * 1. **Total records.** An element is taken whole from one tile — never tags
 *    from one and geometry from another.
 * 2. **Deterministic winner.** Higher `fetchedAt` wins; ties break on tile id,
 *    so the result never depends on array order. (Two tiles fetched in the same
 *    millisecond is ordinary — a working set is fetched concurrently.)
 * 3. **Absence is not deletion.** An element missing from a newer tile means
 *    nothing; it may simply lie outside that tile's bbox. Each tile is
 *    authoritative only within its own bbox, so a demolished building
 *    disappears when the tile that contained it is refetched (§5.2's
 *    `maxAgeMs`), never because a neighbour was refetched.
 * 4. **Provenance survives.** Every element keeps the tile and timestamp it
 *    actually came from.
 *
 * **On OSM `version`:** it would be the better discriminator, but plain
 * `out geom` does not return it — `out meta` does, and that could not be
 * measured to work (findings doc §4). `fetchedAt` ordering is right in the
 * overwhelming majority of cases (a newer fetch usually carries newer data) and
 * its one blind spot is a stale mirror serving old data under a new timestamp.
 * If `out meta geom` is ever cleared, add version as the primary key and demote
 * `fetchedAt` to the tie-break; the shape here does not need to change.
 */
export function mergeTiles(tiles: readonly OsmTileResult[]): MergedTiles {
  const features = new Map<OsmFeatureKey, OsmFeature>();
  const provenance = new Map<OsmFeatureKey, FeatureProvenance>();
  let duplicateCount = 0;
  let oldestFetchedAt: number | undefined;
  let newestFetchedAt: number | undefined;

  // Two passes, and the first one is load-bearing.
  //
  // 1. Collapse repeated results for the SAME tile down to the newest. A tile
  //    covers a fixed bbox, so a newer fetch of it fully supersedes an older
  //    one — including by omission. Without this, a refetch would UNION with
  //    its own stale copy and an element deleted from OSM could never
  //    disappear: a demolished building would persist forever, which is
  //    precisely the case §5.2's `maxAgeMs` refresh exists to fix.
  //
  //    Note this is the ONE place absence does mean deletion, and it is exactly
  //    the place where it is sound: within a single tile's own bbox.
  //
  // 2. Sort ascending so the winner across DIFFERENT tiles is the last write.
  //    Sorting up front is what makes the result independent of the caller's
  //    array order, which the store gives no guarantee about.
  const ordered = [...newestPerTile(tiles).values()].sort(compareTiles);

  for (const tile of ordered) {
    oldestFetchedAt = Math.min(
      oldestFetchedAt ?? tile.fetchedAt,
      tile.fetchedAt,
    );
    newestFetchedAt = Math.max(
      newestFetchedAt ?? tile.fetchedAt,
      tile.fetchedAt,
    );

    for (const feature of tile.features) {
      const key = featureKey(feature);
      if (features.has(key)) duplicateCount++;
      // Whole-record replacement — never a field-by-field merge. This single
      // line is the difference from the C# reference's behaviour.
      features.set(key, feature);
      provenance.set(key, {
        tile: tile.tile,
        fetchedAt: tile.fetchedAt,
        sourceId: tile.sourceId,
      });
    }
  }

  return {
    features,
    provenance,
    ...(oldestFetchedAt === undefined ? {} : { oldestFetchedAt }),
    ...(newestFetchedAt === undefined ? {} : { newestFetchedAt }),
    duplicateCount,
  };
}

/**
 * One result per tile id — the newest.
 *
 * A tile covers a fixed bbox, so a newer fetch of the same tile replaces the
 * older one outright rather than merging with it.
 */
function newestPerTile(
  tiles: readonly OsmTileResult[],
): Map<string, OsmTileResult> {
  const byTile = new Map<string, OsmTileResult>();
  for (const tile of tiles) {
    const existing = byTile.get(tile.tile);
    if (existing === undefined || supersedes(tile, existing)) {
      byTile.set(tile.tile, tile);
    }
  }
  return byTile;
}

/**
 * Does `candidate` replace `existing` for the same tile id?
 *
 * Newer wins. A tie on `fetchedAt` is a **contradictory input** — two fetches of
 * one tile in the same millisecond with different content — which cannot be
 * resolved correctly, only **deterministically**.
 *
 * The tie-break has to be TOTAL, not merely plausible. An earlier version
 * stopped at `sourceId`, and the order-independence property test found the
 * hole immediately: two results from the same source with the same feature
 * count differ only in content, so the comparison returned "no" both ways and
 * whichever arrived first won. That makes the merged index depend on the order
 * the blob store happened to return things in — the exact non-determinism this
 * function exists to remove.
 *
 * So the last resort compares content. It is O(n) in features, which is why it
 * sits behind three cheap discriminators: reaching it requires identical
 * timestamp, identical count and identical source, which essentially never
 * happens outside a test.
 */
function supersedes(
  candidate: OsmTileResult,
  existing: OsmTileResult,
): boolean {
  if (candidate.fetchedAt !== existing.fetchedAt) {
    return candidate.fetchedAt > existing.fetchedAt;
  }
  if (candidate.features.length !== existing.features.length) {
    return candidate.features.length > existing.features.length;
  }
  if (candidate.sourceId !== existing.sourceId) {
    return candidate.sourceId < existing.sourceId;
  }
  return contentOrder(candidate) < contentOrder(existing);
}

/**
 * A stable ordering key over a tile's contents.
 *
 * Only ever evaluated in the pathological tie above. Uses the full feature
 * records rather than just their ids, because two results can carry the same
 * element ids with different tags or geometry — which is precisely the case
 * that has to be ordered.
 */
function contentOrder(tile: OsmTileResult): string {
  return JSON.stringify(tile.features);
}

/** Ascending by `fetchedAt`, then by tile id so the order is total. */
function compareTiles(a: OsmTileResult, b: OsmTileResult): number {
  if (a.fetchedAt !== b.fetchedAt) return a.fetchedAt - b.fetchedAt;
  return a.tile < b.tile ? -1 : a.tile > b.tile ? 1 : 0;
}
