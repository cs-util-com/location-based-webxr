/**
 * Overpass QL query construction, and the H3-cell → bbox conversion it needs.
 *
 * @see overpass-query.ts.md
 */

import { cellToBoundary } from "h3-js";

/**
 * Bumped whenever the query changes shape in a way that makes previously
 * cached tiles non-equivalent (narrowing the tag filter, changing `out` mode).
 *
 * This is part of the cache key. Without it, narrowing the query would silently
 * keep serving old, wider tiles — or worse, widening it would keep serving old,
 * narrower ones and the missing features would look like unmapped ground.
 */
export const OVERPASS_SCHEMA_VERSION = 1;

/** South/west/north/east in WGS84 degrees. */
export interface BoundingBox {
  readonly south: number;
  readonly west: number;
  readonly north: number;
  readonly east: number;
}

/** Thrown for the one input this module genuinely cannot express. */
export class AntimeridianCellError extends Error {
  constructor(readonly cell: string) {
    super(
      `H3 cell ${cell} crosses the antimeridian; a single Overpass bbox cannot express it. ` +
        `Split the query, or use a source that does not go through a bbox.`,
    );
    this.name = "AntimeridianCellError";
  }
}

/**
 * Axis-aligned bounding box of an H3 cell.
 *
 * **The bbox is larger than the hexagon**, so adjacent tiles overlap and some
 * features are fetched more than once. That is accepted — deduplication happens
 * by OSM element id at index time — but it means "features in a tile" and
 * "features returned for a tile" are different sets, which matters when reading
 * a fixture's element count.
 *
 * @throws {AntimeridianCellError} for a cell spanning ±180°. Overpass's bbox is
 *   `south,west,north,east` with west < east, which simply cannot represent a
 *   wrap. Failing loudly beats emitting a bbox that silently covers the whole
 *   globe the wrong way round.
 */
export function cellToBoundingBox(cell: string): BoundingBox {
  const boundary = cellToBoundary(cell); // [[lat, lng], ...]

  let south = Number.POSITIVE_INFINITY;
  let north = Number.NEGATIVE_INFINITY;
  let west = Number.POSITIVE_INFINITY;
  let east = Number.NEGATIVE_INFINITY;

  for (const vertex of boundary) {
    const lat = vertex[0];
    const lng = vertex[1];
    if (lat === undefined || lng === undefined) {
      continue;
    }
    south = Math.min(south, lat);
    north = Math.max(north, lat);
    west = Math.min(west, lng);
    east = Math.max(east, lng);
  }

  if (!Number.isFinite(south) || !Number.isFinite(west)) {
    throw new Error(`Cell ${cell} has no usable boundary`);
  }

  // A res-8 hexagon is ~1 km across, i.e. well under 1° of longitude anywhere.
  // A span above 180° therefore cannot be a real extent — it is the signature
  // of vertices sitting either side of the antimeridian.
  if (east - west > 180) {
    throw new AntimeridianCellError(cell);
  }

  return { south, west, north, east };
}

/**
 * The Overpass QL query for one fetch tile.
 *
 * ```
 * [out:json][timeout:60][bbox:{south},{west},{north},{east}];
 * nwr[~"."~"."];
 * out geom;
 * ```
 *
 * - `nwr` selects nodes, ways and relations in one statement.
 * - `[~"."~"."]` is the Overpass idiom for "has at least one tag". This is the
 *   honest implementation of "everything": untagged nodes carry zero
 *   information for scoring, and their coordinates arrive anyway, inline, via
 *   `out geom` on the parent way or relation. Dropping them server-side removes
 *   the single largest chunk of the payload at no information cost.
 * - `out geom` inlines member coordinates, so there is no second recursive-down
 *   pass and no client-side node-reference resolution — which is exactly the
 *   fragile part of the C# reference's `.ToComplete()` step.
 */
export function buildTileQuery(bbox: BoundingBox, timeoutSeconds = 60): string {
  const { south, west, north, east } = bbox;
  return [
    `[out:json][timeout:${timeoutSeconds}][bbox:${south},${west},${north},${east}];`,
    'nwr[~"."~"."];',
    "out geom;",
  ].join("\n");
}
