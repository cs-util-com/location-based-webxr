/**
 * cell → the features that touch it.
 *
 * The queryable form of a merged tile set. Built once per working set and read
 * many times by the scorer, which is why it is a plain forward index rather
 * than anything cleverer: the access pattern is "give me the features for this
 * cell", tens of thousands of times, and a Map lookup is already the right
 * answer at working-set sizes (~931 cells).
 *
 * @see h3-feature-index.ts.md
 */

import { getHexagonAreaAvg, UNITS } from "h3-js";
import type {
  OsmFeature,
  OsmFeatureKey,
  OsmTags,
} from "../model/osm-feature.js";
import { featureKey } from "../model/osm-feature.js";
import { toGeometry, isArealRelation } from "../model/osm-geometry.js";
import type { GeometryError, OsmGeometry } from "../model/osm-geometry.js";
import { coverCells, cellCentre } from "./cell-coverage.js";
import type { Bbox } from "./clip.js";
import { boundsOf, padBboxByAxis, clipToBbox, positionsOf } from "./clip.js";
import { AFFORDANCE_RES, cellPaddingDegrees } from "./resolutions.js";

/** A feature's contribution to one cell. */
export interface CellFeature {
  readonly feature: OsmFeatureKey;
  /** See `CellCoverage.fraction` — hardcoded to 1 in v1. */
  readonly fraction: number;
}

export interface H3FeatureIndex {
  /** cell → the features touching it. */
  readonly byCell: ReadonlyMap<string, readonly CellFeature[]>;
  /** feature → the cells it touches. The reverse view, for provenance. */
  readonly byFeature: ReadonlyMap<OsmFeatureKey, readonly string[]>;
  /** The features themselves, so a consumer needs only this object. */
  readonly features: ReadonlyMap<OsmFeatureKey, OsmFeature>;
  /** Features whose geometry could not be built. Never silently dropped. */
  readonly failed: readonly GeometryError[];
  readonly resolution: number;
}

export interface BuildIndexOptions {
  readonly resolution?: number;
  /**
   * Only index features touching one of these cells.
   *
   * The reason the index is cheap: a res-7 tile holds ~117k affordance cells,
   * and scoring is only ever done over a ~931-cell working set. Without a
   * restriction the index would cover 126× more ground than anything reads.
   */
  readonly restrictTo?: Iterable<string>;
}

/**
 * Builds the index from features.
 *
 * A feature whose geometry cannot be built is **recorded in `failed`, not
 * thrown**. The planet contains relations that cannot be closed, and one of them
 * must not blank an entire working set — the C# reference throws here, which is
 * wrong for a library that has to survive whatever real data contains.
 */
export function buildFeatureIndex(
  features: Iterable<OsmFeature>,
  options: BuildIndexOptions = {},
): H3FeatureIndex {
  const resolution = options.resolution ?? AFFORDANCE_RES;
  const restrict =
    options.restrictTo === undefined ? undefined : new Set(options.restrictTo);

  const byCell = new Map<string, CellFeature[]>();
  const byFeature = new Map<OsmFeatureKey, string[]>();
  const kept = new Map<OsmFeatureKey, OsmFeature>();
  const failed: GeometryError[] = [];

  const interest = areaOfInterest(restrict, resolution);
  if (interest === "empty") {
    return { byCell, byFeature, features: kept, failed, resolution };
  }

  // Materialised because the redundancy pass below has to see every feature
  // before the first one is indexed: Overpass does not guarantee that a
  // relation precedes its own members, and a cross-tile merge reorders freely.
  const all = [...features];
  const redundant = redundantOuterMembers(all);

  for (const feature of all) {
    const key = featureKey(feature);
    if (redundant.has(key)) continue;

    const prepared = coverableGeometry(feature, interest, resolution, key);
    if (prepared.kind === "failed") {
      failed.push(prepared.error);
      continue;
    }
    if (prepared.kind === "outside") continue;

    const cells = addCoverage(
      byCell,
      key,
      coverCells(prepared.geometry, resolution),
      restrict,
    );

    // A feature touching nothing in the restricted set is not indexed at all —
    // keeping it would grow `features` without ever being readable through
    // `byCell`, which is memory spent on nothing.
    if (cells.length === 0) continue;
    byFeature.set(key, cells);
    kept.set(key, feature);
  }

  return { byCell, byFeature, features: kept, failed, resolution };
}

/**
 * Cells one feature may cover before it is refused.
 *
 * Sized to be unreachable by anything real and still far below where h3 breaks.
 * A whole res-7 fetch tile is ~117k affordance cells, so this is ~8 tiles'
 * worth for ONE feature — about 44 km² at res 13. The largest sane thing in
 * OSM (a national forest, a big lake) sits well under it; the North Sea sits
 * five orders of magnitude over.
 */
const MAX_CELLS_PER_FEATURE = 1_000_000;

/** What `coverableGeometry` decided about one feature. */
type Coverable =
  | { readonly kind: "ok"; readonly geometry: OsmGeometry }
  | { readonly kind: "failed"; readonly error: GeometryError }
  /** Clipped away entirely — not a failure, just not in the area of interest. */
  | { readonly kind: "outside" };

/**
 * Turns a feature into geometry that is safe to cover, or says why it is not.
 *
 * Three steps, in this order, and the order is the point:
 *
 * 1. Build the geometry. A relation that cannot be closed is a `failed` entry.
 * 2. **CLIP FIRST.** Covering costs time proportional to the FEATURE's extent,
 *    and OSM contains features of continental extent — the `beach` fixture is
 *    one element holding the entire North Sea, whose res-13 coverage is on the
 *    order of 10^10 cells. Filtering that down afterwards is not slow, it is
 *    non-terminating in any practical sense.
 * 3. Budget-check what survived. Step 2 only bounds the work when there IS a
 *    restriction, and unbounded covering fails two different ways on real data:
 *    merely huge grinds (measured 2026-07-29: an unrestricted index over the
 *    building-block fixture did not finish in TEN MINUTES, against 113 ms with
 *    `restrictTo`), and genuinely continental THROWS — h3 raises `Array length
 *    out of bounds` from inside `polygonToCellsExperimental`, 57 billion cells
 *    for a 10-degree square, which escaped `buildFeatureIndex` and broke its
 *    "recorded in `failed`, not thrown" contract.
 *
 * Also keeps `buildFeatureIndex` under the complexity ratchet.
 */
function coverableGeometry(
  feature: OsmFeature,
  interest: Bbox | undefined,
  resolution: number,
  key: OsmFeatureKey,
): Coverable {
  const result = toGeometry(feature);
  if (!result.ok) return { kind: "failed", error: result.error };

  const geometry = clipIfRestricted(result.geometry, interest);
  if (geometry === undefined) return { kind: "outside" };

  const estimate = estimateCellCount(geometry, resolution);
  if (estimate <= MAX_CELLS_PER_FEATURE) return { kind: "ok", geometry };
  return {
    kind: "failed",
    error: oversizeError(key, resolution, estimate),
  };
}

/** The `failed` entry for a feature whose coverage would be absurd. */
function oversizeError(
  key: OsmFeatureKey,
  resolution: number,
  estimate: number,
): GeometryError {
  return {
    reason: "coverage-too-large",
    featureKey: key,
    message:
      `Covering ${key} at res ${resolution} needs about ` +
      `${Math.round(estimate).toLocaleString("en-US")} cells, over the ` +
      `${MAX_CELLS_PER_FEATURE.toLocaleString("en-US")} limit. Pass ` +
      `restrictTo to bound the area being indexed.`,
  };
}

/**
 * Roughly how many cells `geometry` would cover at `resolution`.
 *
 * Bounding box over average hexagon area — deliberately crude, because it only
 * has to separate "normal" from "absurd", and those differ by five orders of
 * magnitude. It OVER-estimates for a sparse shape (a long diagonal road has a
 * large bbox and little coverage), which is the safe direction for a guard that
 * refuses work: a false refusal is a recorded, actionable `failed` entry, while
 * a false acceptance is the ten-minute hang this exists to prevent.
 */
function estimateCellCount(geometry: OsmGeometry, resolution: number): number {
  const bbox = boundsOf(positionsOf(geometry));
  if (bbox === undefined) return 0;

  const midLat = ((bbox.north + bbox.south) / 2) * (Math.PI / 180);
  const heightM = (bbox.north - bbox.south) * METRES_PER_DEGREE;
  const widthM = (bbox.east - bbox.west) * METRES_PER_DEGREE * Math.cos(midLat);
  const areaM2 = Math.abs(heightM) * Math.abs(widthM);

  return areaM2 / getHexagonAreaAvg(resolution, UNITS.m2);
}

/** Metres per degree of latitude. Close enough for an order-of-magnitude test. */
const METRES_PER_DEGREE = 111_320;

/** Geometry clipped to the area of interest, or unchanged when unrestricted. */
function clipIfRestricted(
  geometry: OsmGeometry,
  interest: Bbox | undefined,
): OsmGeometry | undefined {
  return interest === undefined ? geometry : clipToBbox(geometry, interest);
}

/**
 * Members of an areal relation whose own contribution would be a pure
 * duplicate of their parent's.
 *
 * THE PROBLEM. A `type=multipolygon` relation stands for the area; its
 * `role=outer` ways are that area's boundary. Under old-style tagging the outer
 * way repeats the relation's tags, and when it does, Overpass returns BOTH as
 * top-level elements. They cover the same cells, so the multiplicative kernel
 * applies the shared tags twice — a factor of 10 becomes 100. Silent, and only
 * ever over-scoring, which is the direction that makes bad ground look good.
 *
 * WHY THIS IS NARROWER THAN THE C# REFERENCE, DELIBERATELY. The reference
 * (`OsmGeoSpatialIndexer.alreadyHandledOuterRelationMembers`) removes every
 * `role=outer` member unconditionally. That is wrong when the way carries tags
 * of its own: a `barrier=fence` way bounding a `natural=wood` relation is a real
 * feature, and dropping it loses the fence entirely — the relation does not
 * carry that tag. So a member is suppressed only when **every one of its tags
 * appears on the parent with the same value**, i.e. when its factor is provably
 * a sub-product of the parent's and multiplying both squares it.
 *
 * Three cases are deliberately NOT suppressed:
 * - `role=inner`. A hole carries its own tags and is a real area — `natural=wood`
 *   inside a lake is separately scoreable, and the relation does not carry it.
 *   Measured: 1 of 6 areal relations in the fixtures has an inner member that
 *   also arrives as a top-level element, so this case is real.
 * - A member whose parent relation is absent. A tile boundary can deliver the
 *   way without the relation, and absence of the parent is not evidence.
 * - A member of a NON-areal relation (`type=route` and friends). There the
 *   members ARE the features; suppressing them would drop the roads.
 *
 * RESIDUAL, DOCUMENTED: a member sharing SOME tags with its parent and adding
 * others is kept whole, so the shared subset is still counted twice. Scoring
 * only its unique tags would mean synthesising a feature that never existed,
 * which breaks provenance and the whole-record rule the tile merge is built on.
 * The overlap case is rare — a way with distinct tags usually has no tag in
 * common with its parent at all.
 *
 * Measured across the four fixtures: 6 areal relations, **zero** outer members
 * also returned. So this guard is preventive rather than corrective — it fires
 * on no checked-in data today, and the case it prevents is one tag away.
 */
function redundantOuterMembers(
  features: readonly OsmFeature[],
): ReadonlySet<OsmFeatureKey> {
  const redundant = new Set<OsmFeatureKey>();
  const byKey = new Map<OsmFeatureKey, OsmFeature>();
  for (const feature of features) byKey.set(featureKey(feature), feature);

  for (const feature of features) {
    if (feature.type !== "relation") continue;
    if (!isArealRelation(feature)) continue;

    for (const member of feature.members) {
      if (member.role !== "outer") continue;
      const key: OsmFeatureKey = `${member.type}/${member.ref}`;
      const present = byKey.get(key);
      if (present === undefined) continue;
      if (tagsAreSubsetOf(present.tags, feature.tags)) redundant.add(key);
    }
  }

  return redundant;
}

/** True when every entry of `subset` appears in `superset` with the same value. */
function tagsAreSubsetOf(subset: OsmTags, superset: OsmTags): boolean {
  for (const [key, value] of Object.entries(subset)) {
    if (superset[key] !== value) return false;
  }
  return true;
}

/**
 * The padded bbox to clip geometry against, from a cell restriction.
 *
 * Three distinct answers, and the third is the one that used to crash:
 * - `undefined` — no restriction, so no clipping.
 * - a `Bbox` — clip to it.
 * - `"empty"` — the restriction exists but contains nothing, so the caller
 *   should return an empty index. A legitimate input meaning "score nothing
 *   here" (a fully-filtered working set, or a computed set that came back
 *   empty), which previously dereferenced undefined bounds and threw a
 *   TypeError from inside `padBbox`.
 *
 * THE PADDING IS DERIVED, NOT GUESSED, and that changed on 2026-07-31. The
 * bounds are over cell CENTRES, so the box must then grow by however far a cell
 * reaches past its own centre, or geometry that genuinely touches an edge cell
 * is clipped away and that cell silently loses coverage. It used to grow by a
 * flat `CLIP_MARGIN_DEG = 0.0005` (~55.7 m), justified in a comment by the
 * res-11 CHUNK edge (28.7 m) — but the set being bounded is res-13 cells, whose
 * reach is 3.72 m. Two things were wrong with that:
 *
 * - It cited the wrong resolution, so it was right by accident.
 * - A flat DEGREE margin is a shrinking DISTANCE as latitude rises: above ~80°
 *   the longitude side of it falls under one cell, and past that the clip cuts
 *   inside cells the restriction asks about. Nothing in the package fetches
 *   there today, which is why it had never been seen.
 *
 * `cellPaddingDegrees` replaces it with the grid's own geometry, per axis, at
 * the latitude that actually matters. It is NOT a speed change — measured at
 * −4 % to −29 % with zero retained cells altered, because the polygon cover
 * costs per call rather than per unit area.
 */
function areaOfInterest(
  restrict: Set<string> | undefined,
  resolution: number,
): Bbox | undefined | "empty" {
  if (restrict === undefined) return undefined;
  const bounds = boundsOf([...restrict].map((cell) => cellCentre(cell)));
  if (bounds === undefined) return "empty";

  // The corner furthest from the equator, so the longitude padding is
  // sufficient across the whole box rather than only at its nearer edge.
  const worstLatitude = Math.max(
    Math.abs(bounds.north),
    Math.abs(bounds.south),
  );
  return padBboxByAxis(bounds, cellPaddingDegrees(resolution, worstLatitude));
}

/** Files one feature's coverage into `byCell`; returns the cells it landed in. */
function addCoverage(
  byCell: Map<string, CellFeature[]>,
  key: OsmFeatureKey,
  covered: readonly { cell: string; fraction: number }[],
  restrict: Set<string> | undefined,
): string[] {
  const cells: string[] = [];
  for (const { cell, fraction } of covered) {
    if (restrict !== undefined && !restrict.has(cell)) continue;
    cells.push(cell);
    const entry: CellFeature = { feature: key, fraction };
    const bucket = byCell.get(cell);
    if (bucket === undefined) byCell.set(cell, [entry]);
    else bucket.push(entry);
  }
  return cells;
}

/** The features touching a cell. Empty array for an unknown cell. */
export function featuresAt(
  index: H3FeatureIndex,
  cell: string,
): readonly CellFeature[] {
  return index.byCell.get(cell) ?? [];
}

/**
 * Total number of (cell, feature) pairs.
 *
 * The size that actually predicts scoring cost — `byCell.size` undercounts
 * badly wherever features overlap, which in a city is everywhere.
 */
export function indexEntryCount(index: H3FeatureIndex): number {
  let total = 0;
  for (const entries of index.byCell.values()) total += entries.length;
  return total;
}
