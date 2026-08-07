/**
 * The obstacle index — what blocks an agent, and at what height.
 *
 * **Keyed on H3 cells, holding lat/lng, and never ENU.**
 *
 * The original reason was that `BuildingVolume.footprint` is in ENU metres in a
 * frame rebuilt on every publish, so every recentre invalidated every coordinate
 * in it. **That reason is now weaker than it was** (DEC-R11-8): the demo's scene
 * anchor no longer follows the user, so an ordinary step invalidates nothing.
 *
 * The decision stands anyway, on grounds that did not change:
 *
 * - the anchor still moves on a declared place change or past 5 km, so ENU
 *   coordinates still go stale — rarely rather than constantly;
 * - an index can outlive the scene that built it, and absolute coordinates
 *   survive what relative ones do not;
 * - building from `OsmFeature` geometry, which is lat/lng from Overpass
 *   `out geom`, makes it **structural**: no publish-frame coordinate is ever in
 *   scope in this file, so the mistake is not available rather than merely
 *   avoided.
 *
 * So: **preferred and structural, no longer strictly required.**
 *
 * The one place metres are unavoidable is thickness: a wall is 0.5 m wide, not
 * 0.5° wide. So each footprint is built in a frame anchored at **the feature's
 * own first vertex** and converted straight back to lat/lng. That anchor is a
 * property of the feature, not of the current view, so nothing about it moves
 * when the user does.
 *
 * **The antimeridian is not handled**, and that matches the package rather than
 * departing from it: `overpass-query.ts` throws `AntimeridianCellError` for a
 * cell straddling the date line, so such data cannot reach this index through
 * the normal ingest path at all, and `multipolygon-builder.ts` documents the
 * same non-handling. Raised by CodeRabbit on #259; making this one module
 * wrap-aware while every module around it still refuses or ignores the case
 * would buy false confidence rather than correctness.
 *
 * @see obstacles.ts.md
 */

import {
  featureKey,
  type OsmFeature,
  type OsmFeatureKey,
} from "../model/osm-feature.js";
import { barrierFootprints } from "../mesh/barrier-shape.js";
import {
  barrierCentrelines,
  isSolidBarrier,
  resolveBarrier,
} from "../mesh/barriers.js";
import { enuFrameAt } from "../mesh/enu.js";
import { coverCells } from "../spatial/cell-coverage.js";
import { AFFORDANCE_RES } from "../spatial/resolutions.js";
import type { PlanarPoint } from "../spatial/point-in-ring.js";

/** Something an agent cannot walk through, and the level it can stand on. */
export interface Obstacle {
  readonly feature: OsmFeatureKey;
  /** Height above the ground beneath it, metres. Never absolute. */
  readonly heightM: number;
  /**
   * Footprint rings as `x = lng`, `y = lat`.
   *
   * Degrees, so `containsPoint` can be asked directly — crossing parity is
   * affine-invariant, so the latitude/longitude anisotropy needs no correction.
   */
  readonly rings: readonly (readonly PlanarPoint[])[];
}

/** Obstacles, looked up by the cells they cover. */
export interface ObstacleIndex {
  obstaclesIn(cell: string): readonly Obstacle[];
  /** Every cell the index holds something for. */
  readonly cells: ReadonlySet<string>;
}

/**
 * The same lines `barrier-volumes.ts` draws, as `x = lng, y = lat`.
 *
 * **Shared rather than re-derived** — `barrierCentrelines` owns which rings of
 * which geometry kinds a barrier runs along, and the reasoning behind that took
 * three review rounds (#259, #260, #263). Two copies could drift, and a drawn
 * wall that is not indexed is an agent walking through something the viewer can
 * see.
 */
function barrierLines(feature: OsmFeature): readonly PlanarPoint[][] {
  return barrierCentrelines(feature).map((line) =>
    line.map((p) => ({ x: p.lng, y: p.lat })),
  );
}

/**
 * Builds an index over the solid barriers in `features`.
 *
 * Features that are not solid barriers, and barriers whose geometry cannot make
 * a footprint, are skipped — a one-node way and an empty way are both ordinary
 * Overpass output.
 */
export function buildObstacleIndex(
  features: Iterable<OsmFeature>,
  resolution: number = AFFORDANCE_RES,
): ObstacleIndex {
  const byCell = new Map<string, Obstacle[]>();

  for (const feature of features) {
    if (!isSolidBarrier(feature)) continue;

    const lines = barrierLines(feature);
    if (lines.length === 0) continue;

    const { heightM, thicknessM } = resolveBarrier(feature.tags);

    // ANCHORED AT THE FEATURE'S OWN FIRST VERTEX. Thickness is metres, so a
    // metric frame is unavoidable — but this one belongs to the feature rather
    // than to the current view, so the lat/lng it produces stay valid across
    // every recentre. ONE frame for the whole feature, so every part is
    // expressed against the same anchor.
    const anchor = { lat: lines[0]![0]!.y, lng: lines[0]![0]!.x };
    const frame = enuFrameAt(anchor);

    const rings = lines.flatMap((line) => {
      const enuLine = line.map((p) => frame.toEnu({ lat: p.y, lng: p.x }));
      return barrierFootprints(enuLine, thicknessM).map((ring) =>
        ring.map((v) => {
          const back = frame.toLatLng(v);
          return { x: back.lng, y: back.lat };
        }),
      );
    });
    if (rings.length === 0) continue;

    const obstacle: Obstacle = {
      feature: featureKey(feature),
      heightM,
      rings,
    };

    // THE FEATURE'S CELLS COLLECTED ONCE, then appended once.
    //
    // WHAT THIS REMOVES IS THE RESCAN, not the h3 calls — an earlier comment
    // here claimed the latter and was wrong (#260). `coverCells` still runs
    // once per ring, and batching cannot change that: `coverCells` runs
    // `addPolygon` once per POLYGON (`cell-coverage.ts`), and in the batched
    // alternative each quad would be its own polygon — so the per-quad cost is
    // inherent to per-segment footprints either way. Stated literally because
    // the comment this replaces was itself wrong about this same function
    // (#263).
    //
    // What went away is the `existing.includes(obstacle)` scan of every cell's
    // list, once per ring — and the union makes "one obstacle per cell"
    // structural rather than something a linear search has to enforce.
    const cells = new Set<string>();
    for (const ring of rings) {
      const coverage = coverCells(
        { kind: "polygon", rings: [ring.map((v) => ({ lat: v.y, lng: v.x }))] },
        resolution,
      );
      for (const covered of coverage) cells.add(covered.cell);
    }

    for (const cell of cells) {
      const existing = byCell.get(cell);
      if (existing === undefined) byCell.set(cell, [obstacle]);
      else existing.push(obstacle);
    }
  }

  return {
    obstaclesIn: (cell) => byCell.get(cell) ?? [],
    cells: new Set(byCell.keys()),
  };
}

/**
 * The heights at which an agent can stand in `cell` — the `levelsAt` that
 * `columnSpace` consumes.
 *
 * **The ground is always offered, alongside every obstacle top.** A res-13 cell
 * is ~8 m across and a wall is under a metre thick, so a cell containing a wall
 * also contains the ground beside it. Removing the ground level would make it
 * impossible to walk *next to* a wall, which is not what a wall does.
 *
 * Obstacle heights are **added to the ground beneath them**: a 2 m wall on a
 * 30 m hill is standable at 32 m. Treating them as absolute would put every
 * wall top underground on any real slope.
 *
 * Returns `[]` when the ground height is unknown. A `NaN` level would make
 * `columnsAdjacent` refuse every step involving it — an invisible wall — while
 * a cell with no levels is at least visibly unreachable.
 */
export function obstacleLevelsAt(
  index: ObstacleIndex,
  cell: string,
  groundAt: (cell: string) => number,
): number[] {
  const ground = groundAt(cell);
  if (!Number.isFinite(ground)) return [];

  const levels = new Set<number>([ground]);
  for (const obstacle of index.obstaclesIn(cell)) {
    const top = ground + obstacle.heightM;
    if (Number.isFinite(top)) levels.add(top);
  }

  // SORTED, for the same reason every other list here is: a route that varied
  // with the order Overpass happened to return features would be
  // unreproducible.
  return [...levels].sort((a, b) => a - b);
}
