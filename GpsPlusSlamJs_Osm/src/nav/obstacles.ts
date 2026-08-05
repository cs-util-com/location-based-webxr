/**
 * The obstacle index — what blocks an agent, and at what height.
 *
 * **Keyed on H3 cells, holding lat/lng, and never ENU.** The navigation design
 * names this hazard twice: `BuildingVolume.footprint` is in ENU metres in a
 * frame rebuilt on every publish, so **every recentre invalidates every
 * coordinate in it**. Building from `OsmFeature` geometry instead — which is
 * lat/lng, from Overpass `out geom` — makes that structural rather than
 * something to remember, because no publish-frame coordinate is ever in scope
 * here.
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
import { toGeometry } from "../model/osm-geometry.js";
import { barrierFootprints } from "../mesh/barrier-shape.js";
import { isSolidBarrier, resolveBarrier } from "../mesh/barriers.js";
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

/** The lat/lng line a barrier feature runs along, or `undefined`. */
function barrierLine(feature: OsmFeature): readonly PlanarPoint[] | undefined {
  const result = toGeometry(feature);
  if (!result.ok) return undefined;

  const geometry = result.geometry;
  // MULTIPOLYGON IS HANDLED, not silently dropped. A `barrier=wall` mapped as a
  // multipolygon relation is rare, but it is neither "not a barrier" nor
  // "unusable geometry" — it would have been a barrier the index simply did not
  // see, which is the one skip reason with no stated rationale. Raised in
  // review on #259. Only the first polygon's outer ring is used: a barrier's
  // holes are not something to walk through.
  const positions =
    geometry.kind === "linestring"
      ? geometry.positions
      : geometry.kind === "polygon"
        ? geometry.rings[0]
        : geometry.kind === "multipolygon"
          ? geometry.polygons[0]?.[0]
          : geometry.kind === "multilinestring"
            ? geometry.lines[0]
            : undefined;
  if (positions === undefined || positions.length < 2) return undefined;

  return positions.map((p) => ({ x: p.lng, y: p.lat }));
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

    const line = barrierLine(feature);
    if (line === undefined) continue;

    const { heightM, thicknessM } = resolveBarrier(feature.tags);

    // ANCHORED AT THE FEATURE'S OWN FIRST VERTEX. Thickness is metres, so a
    // metric frame is unavoidable — but this one belongs to the feature rather
    // than to the current view, so the lat/lng it produces stay valid across
    // every recentre.
    const anchor = { lat: line[0]!.y, lng: line[0]!.x };
    const frame = enuFrameAt(anchor);
    const enuLine = line.map((p) => frame.toEnu({ lat: p.y, lng: p.x }));

    const rings = barrierFootprints(enuLine, thicknessM).map((ring) =>
      ring.map((v) => {
        const back = frame.toLatLng(v);
        return { x: back.lng, y: back.lat };
      }),
    );
    if (rings.length === 0) continue;

    const obstacle: Obstacle = {
      feature: featureKey(feature),
      heightM,
      rings,
    };

    // THE FEATURE'S CELLS COLLECTED ONCE, then appended once. A city wall is
    // routinely a few hundred nodes, so appending per ring meant a few hundred
    // `polygonToCellsExperimental` calls plus an `includes` rescan of every
    // cell's list on top — and `polygonToCells` is already the measured hot
    // spot of the whole scoring path. The union also makes "one obstacle per
    // cell" structural instead of a linear scan. Raised in review on #259.
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
