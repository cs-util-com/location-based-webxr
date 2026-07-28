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
export const OVERPASS_SCHEMA_VERSION = 2;

/**
 * The OSM keys whose elements are worth fetching.
 *
 * **Provenance: this exact list is the only Overpass query in this project that
 * has ever fetched a full-size tile.** It began in `scripts/capture-fixtures.mjs`
 * and lived only there, which is precisely why the production query stayed
 * broken for so long — the working query was in a file no gate ran. The capture
 * script now imports this constant, and a test asserts the two agree.
 *
 * **The filter selects which ELEMENTS come back; `out geom` still returns every
 * tag of each one.** So the long tail the scoring model depends on survives: a
 * building matched on `building` still arrives carrying `wheelchair=yes`, a path
 * matched on `highway` still arrives carrying `surface=sand`. What is lost is
 * only elements carrying NONE of these keys.
 *
 * **Only ever widen this list.** Every key removed is scoring signal that can
 * never arrive, and the symptom is silent — an element that never arrives scores
 * the multiplicative identity, which reads as "nothing is mapped here" rather
 * than as a bug.
 */
export const OVERPASS_SELECT_KEYS: readonly string[] = [
  "highway",
  "surface",
  "landuse",
  "natural",
  "leisure",
  "amenity",
  "barrier",
  "access",
  "wheelchair",
  "water",
  "waterway",
  "man_made",
  "tourism",
  "sport",
  "playground",
  "building",
  "building:part",
  "building:levels",
  "height",
  "min_height",
  "roof:shape",
  "roof:levels",
  "layer",
  "historic",
  "place",
  "power",
  "entrance",
  "railway",
  "service",
  "foot",
  "crossing",
  "sidewalk",
];

/**
 * Default `[timeout:]`, in seconds.
 *
 * Generous on purpose. `timeout:` bounds Overpass's **execution** time (not
 * queue wait), and only the time actually consumed is charged against the slot
 * allocation — so a high ceiling costs nothing on a fast query while avoiding a
 * needless kill in a denser city than the one we measured. A full res-7 tile
 * completed in 18 s; the previous default of 60 had never completed one at all.
 */
const DEFAULT_TIMEOUT_SECONDS = 180;

/** Keys are normally a checked-in constant, but the list is overridable. */
const SAFE_KEY_RE = /^[A-Za-z][A-Za-z0-9_:-]*$/;

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

  // A res-7 hexagon is ~2.8 km across, i.e. well under 1° of longitude anywhere.
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
 * [out:json][timeout:180][bbox:{south},{west},{north},{east}];
 * (nwr["highway"];nwr["surface"];...);
 * out geom;
 * ```
 *
 * **A union of exact-key statements, NOT a key regex — this is the difference
 * between a working client and a broken one.** Measured 2026-07-28 on a res-7
 * tile: the union returned 200 OK in 18.2 s (28.31 MB, 21,847 elements), while
 * `nwr[~"^(k1|k2|...)$"~"."]` over the same 32 keys returned 504 after 8 s. The
 * regex form makes Overpass evaluate a pattern against every key of every
 * element in the bbox and degrades with the alternation count; exact-key
 * statements use the key index. This one query form is why the project spent a
 * day believing public Overpass instances were saturated.
 *
 * - `nwr` selects nodes, ways and relations in each statement.
 * - **One union block, one trailing `out`** — the union is a set, so each
 *   element is returned exactly once. (An earlier measurement recorded the
 *   union as duplicating elements; that was an artefact of running the
 *   statements as separate queries.)
 * - `out geom` inlines member coordinates, so there is no second recursive-down
 *   pass and no client-side node-reference resolution — which is exactly the
 *   fragile part of the C# reference's `.ToComplete()` step.
 *
 * @param keys override for {@link OVERPASS_SELECT_KEYS}, e.g. for a self-hosted
 *   instance that can afford a wider filter.
 * @throws if `keys` is empty, or contains anything that could break out of the
 *   statement it is interpolated into.
 */
export function buildTileQuery(
  bbox: BoundingBox,
  timeoutSeconds = DEFAULT_TIMEOUT_SECONDS,
  keys: readonly string[] = OVERPASS_SELECT_KEYS,
): string {
  if (keys.length === 0) {
    // Never silently fall back to an unfiltered query: that is exactly the form
    // measured to 504 on every tile size tried.
    throw new Error(
      "buildTileQuery needs at least one key to select on; an unfiltered query does not complete",
    );
  }
  for (const key of keys) {
    if (!SAFE_KEY_RE.test(key)) {
      throw new Error(
        `Invalid Overpass key ${JSON.stringify(key)}: keys must match ${String(SAFE_KEY_RE)}`,
      );
    }
  }

  const { south, west, north, east } = bbox;
  return [
    `[out:json][timeout:${timeoutSeconds}][bbox:${south},${west},${north},${east}];`,
    `(${keys.map((key) => `nwr["${key}"];`).join("")});`,
    "out geom;",
  ].join("\n");
}
