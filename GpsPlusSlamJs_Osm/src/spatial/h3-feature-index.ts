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

import type { OsmFeature, OsmFeatureKey } from "../model/osm-feature.js";
import { featureKey } from "../model/osm-feature.js";
import { toGeometry } from "../model/osm-geometry.js";
import type { GeometryError } from "../model/osm-geometry.js";
import { coverCells, cellCentre } from "./cell-coverage.js";
import type { Bbox } from "./clip.js";
import { boundsOf, padBbox, clipToBbox } from "./clip.js";
import { AFFORDANCE_RES } from "./resolutions.js";

/**
 * Margin added around the area of interest before clipping, in degrees.
 *
 * ~55 m at the equator and less with latitude — comfortably more than one
 * res-11 chunk (28.7 m edge), so the clip can never cut inside a cell that the
 * restriction actually asks about. Over-keeping costs a few cells that are then
 * filtered; under-keeping would lose real coverage at the working set's edge.
 */
const CLIP_MARGIN_DEG = 0.0005;

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

  const interest = areaOfInterest(restrict);
  if (interest === "empty") {
    return { byCell, byFeature, features: kept, failed, resolution };
  }

  for (const feature of features) {
    const result = toGeometry(feature);
    if (!result.ok) {
      failed.push(result.error);
      continue;
    }

    // CLIP FIRST. Covering costs time proportional to the FEATURE's extent, and
    // OSM contains features of continental extent — the `beach` fixture is a
    // single element holding the entire North Sea, whose res-13 coverage is on
    // the order of 10^10 cells. Filtering that down afterwards is not slow, it
    // is non-terminating in any practical sense. Clipping makes the cost
    // proportional to the working set instead, which is the whole point.
    const geometry =
      interest === undefined
        ? result.geometry
        : clipToBbox(result.geometry, interest);
    if (geometry === undefined) continue;

    const key = featureKey(feature);
    const cells = addCoverage(
      byCell,
      key,
      coverCells(geometry, resolution),
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
 */
function areaOfInterest(
  restrict: Set<string> | undefined,
): Bbox | undefined | "empty" {
  if (restrict === undefined) return undefined;
  const bounds = boundsOf([...restrict].map((cell) => cellCentre(cell)));
  if (bounds === undefined) return "empty";
  return padBbox(bounds, CLIP_MARGIN_DEG);
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
