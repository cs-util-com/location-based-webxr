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
export const OVERPASS_SCHEMA_VERSION = 3;

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
 * (nw["highway"];...;relation["highway"]["type"~"^(multipolygon|boundary)$"];...);
 * out geom;
 * ```
 *
 * **A union of exact-key statements, NOT a key regex — this is the difference
 * between a working client and a broken one.** Measured 2026-07-28 on a res-7
 * tile: the union returned 200 OK while
 * `nwr[~"^(k1|k2|...)$"~"."]` over the same 32 keys returned 504 after 8 s. The
 * regex form makes Overpass evaluate a pattern against every key of every
 * element in the bbox and degrades with the alternation count; exact-key
 * statements use the key index. This one query form is why the project spent a
 * day believing public Overpass instances were saturated.
 *
 * **That run's payload figures are RETRACTED and only its verdict survives.**
 * It recorded 28.31 MB / 21,847 elements for the tile; both were withdrawn on
 * 2026-08-09 (N2/W2, `resolutions.ts` FETCH_RES) as under half the real payload
 * with no host or artefact behind them. The union-beats-regex comparison does
 * not depend on either number — a 200 against a 504 is the whole result.
 *
 * - **`nw` for nodes and ways, plus a SEPARATE areal-relation statement per key**
 *   (F32, adopted 2026-08-03). It was `nwr`, which took every relation touching
 *   the bbox — and that is the whole difference between 68.0 MB and 21.1 MB per
 *   res-7 tile. See the body for the measurement and for why it is provably a
 *   no-op on output.
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
    // AREAL-ONLY (F32, adopted 2026-08-03). `nw[key]` selects nodes and ways;
    // relations are taken only when they are `multipolygon` or `boundary`.
    //
    // **MEASURED 3.2x SMALLER AT THE SAME LATENCY.** The 2026-08-03 sweep put
    // this at 21.1 MB per res-7 tile against the previous `nwr` form's 68.0 MB,
    // with a median total time of 20 s against 23 s — and two independent sweep
    // runs agreed on both figures to three significant figures.
    //
    // **AND IT IS PROVABLY A NO-OP ON OUTPUT**, which is the part that made it
    // adoptable rather than merely attractive. §0.3 of the round-6 plan named
    // the hazard as "drops route, waterway and power relations that currently
    // arrive carrying scoring tags" — but `buildFeatureIndex` ALREADY refuses
    // any relation whose `type` is not areal, so the scorer never saw one.
    // `areal-only-differential.test.ts` reconstructs the old payload from a
    // captured companion fixture and pins the result: over the Cologne extract,
    // the worst case in the corpus at 85 dropped relations, **0 of 86 172
    // cell-category scores change, and buildings, plates and roads come out
    // bit-identical.** The bytes this removes were fetched, parsed and thrown
    // away on the next line.
    //
    // The one thing to watch: if a future rule ever needs a `type=route`,
    // `waterway` or `power` relation, this query stops delivering it and the
    // differential test is what will say so.
    //
    // **ONE RELATION STATEMENT, NOT 32** (2026-09-20). The relation half was
    // where the time went and almost none of the data: measured on
    // `z.overpass-api.de`, 32 keyed relation selectors returned 4 elements of
    // 282 at res 10 and 95 of 32,260 at res 7, for roughly HALF the query's
    // total time. Medians over 5 paired samples at Cologne res 7 are 18.6 s for
    // the old 64-statement form against 10.8 s for this one; over Manhattan's
    // 22 km² box, 24.3 s against 12.9 s. The old form also carried the variance,
    // ranging 12.0-27.1 s.
    //
    // **The statement is unqualified by key on purpose, and that is the part
    // that is a proof rather than a measurement.** For any key `k`,
    // `relation["k"]["type"~R]` selects a subset of `relation["type"~R]` over
    // the same bbox, so this single statement is a strict SUPERSET of the 32 it
    // replaces. Nothing production used to receive can go missing.
    //
    // What the superset ADDS - areal relations carrying none of the selected
    // keys - is removed again by `dropUnselectedRelations` before parsing, so
    // the element set reaching the index is byte-for-byte the old one. See that
    // function for why the extra relations are filtered rather than kept.
    `(${keys.map((key) => `nw["${key}"];`).join("")}relation["type"~"^(multipolygon|boundary)$"];);`,
    "out geom;",
  ].join("\n");
}

/** The result of {@link dropUnselectedRelations}. */
export interface FilteredOverpassPayload {
  /** The payload, with unselected relations removed. */
  readonly elements: unknown;
  /** How many relations were dropped, for telemetry and diagnostics. */
  readonly droppedRelations: number;
}

/**
 * Removes the relations {@link buildTileQuery}'s single relation statement
 * admits and the 32 keyed statements it replaced would not have returned.
 *
 * **Why filter at all, when the extra data might be useful.** The extra
 * relations are areal, so `buildFeatureIndex` would accept them rather than
 * discard them the way it discards non-areal ones. Whether any of them could
 * move a score is an empirical question about the rule table, and **not one set
 * theory can answer**: an element arrives on ANY selected key and then brings
 * ALL its tags, so rules keyed on non-selected tags fire routinely on
 * incidentally delivered elements. "They carry no selected key, so no rule can
 * match them" is the plausible-and-wrong step.
 *
 * So the question is made moot rather than answered. With this filter the set
 * reaching the parser is identical to the one production has always parsed, the
 * query is the only thing that changed, and no scoring differential is needed.
 * **If a later differential shows the extra relations are worth keeping, this
 * is the one call to delete.**
 *
 * Filtering happens BEFORE `parseOverpassJson`, so the dropped relations' `geom`
 * member arrays are never walked - which is where the parse cost of the extra
 * ~2-5% payload would otherwise land.
 *
 * Defensive: a payload shape this does not recognise is passed through
 * unchanged rather than rejected, because the parser downstream is what owns
 * rejecting it. Swallowing a bad shape here would turn a loud parse failure
 * into a silent empty tile.
 */
export function dropUnselectedRelations(
  payload: unknown,
  keys: readonly string[] = OVERPASS_SELECT_KEYS,
): FilteredOverpassPayload {
  const elements = (payload as { elements?: unknown } | null | undefined)
    ?.elements;
  if (!Array.isArray(elements)) {
    return { elements, droppedRelations: 0 };
  }
  const selected = new Set(keys);
  let droppedRelations = 0;
  const kept = elements.filter((element) => {
    const record = element as
      { type?: unknown; tags?: Record<string, unknown> } | null | undefined;
    // Nodes and ways are never touched: both query forms select them with the
    // identical 32 `nw` statements, so filtering them could only lose data.
    if (record?.type !== "relation") return true;
    const tags = record.tags;
    const carriesSelectedKey =
      tags !== undefined &&
      tags !== null &&
      Object.keys(tags).some((tag) => selected.has(tag));
    if (carriesSelectedKey) return true;
    droppedRelations += 1;
    return false;
  });
  return { elements: kept, droppedRelations };
}
