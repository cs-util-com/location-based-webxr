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
import { cellToLatLng, gridDisk } from "h3-js";

import { barrierFootprints } from "../mesh/barrier-shape.js";
import {
  GATE_GAP_M,
  type GateOpenings,
  gateOpenings,
} from "../mesh/barrier-gates.js";
import { passageOpenings } from "./building-passages.js";
import {
  barrierCentrelines,
  isSolidBarrier,
  resolveBarrier,
} from "../mesh/barriers.js";
import { solidBuildingFootprints } from "../mesh/buildings.js";
import { resolveHeights } from "../mesh/building-heights.js";
import { enuFrameAt } from "../mesh/enu.js";
import { coverCells } from "../spatial/cell-coverage.js";
import { segmentCrossesRing } from "../spatial/segment-crossing.js";
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
  /**
   * Points on the boundary where a mapped opening lets a step through
   * (DEC-R12-3) — today, where a `tunnel=building_passage` way pierces it.
   *
   * ABSENT ON ALMOST EVERYTHING, which is why it is optional rather than an
   * empty array everywhere: passages are common in a city extract and rare per
   * building, and `crossesObstacle` runs on the search's hottest path.
   *
   * Degrees, `x = lng`, `y = lat`, exactly as {@link rings} are.
   */
  readonly openings?: readonly PlanarPoint[];
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
function barrierLines(
  feature: OsmFeature,
  gates: GateOpenings,
): readonly PlanarPoint[][] {
  return barrierCentrelines(feature, gates).map((line) =>
    line.map((p) => ({ x: p.lng, y: p.lat })),
  );
}

/**
 * Builds an index over the solid barriers AND buildings in `features`.
 *
 * Features that are neither, and barriers whose geometry cannot make a
 * footprint, are skipped — a one-node way and an empty way are both ordinary
 * Overpass output.
 *
 * **Buildings follow the same parts-else-outline rule the extruder draws**
 * (`solidBuildingFootprints`), so what blocks an agent and what appears on
 * screen are the same set of volumes.
 */
export function buildObstacleIndex(
  features: Iterable<OsmFeature>,
  resolution: number = AFFORDANCE_RES,
): ObstacleIndex {
  const byCell = new Map<string, Obstacle[]>();
  const all = [...features];

  addBarriers(all, resolution, byCell);
  addBuildings(all, resolution, byCell);

  return {
    obstaclesIn: (cell) => byCell.get(cell) ?? [],
    cells: new Set(byCell.keys()),
  };
}

/** Indexes `obstacle` under every cell its rings cover. */
function indexUnderCells(
  obstacle: Obstacle,
  resolution: number,
  byCell: Map<string, Obstacle[]>,
): void {
  // THE FEATURE'S CELLS COLLECTED ONCE, then appended once.
  //
  // WHAT THIS REMOVES IS THE RESCAN, not the h3 calls — an earlier comment
  // claimed the latter and was wrong (#260). `coverCells` still runs once per
  // ring, and batching cannot change that: it runs `addPolygon` once per
  // POLYGON (`cell-coverage.ts`), and in the batched alternative each quad
  // would be its own polygon — so the per-quad cost is inherent to per-segment
  // footprints either way. Stated literally because the comment this replaces
  // was itself wrong about this same function (#263).
  //
  // What went away is the `existing.includes(obstacle)` scan of every cell's
  // list, once per ring — and the union makes "one obstacle per cell"
  // structural rather than something a linear search has to enforce.
  const cells = new Set<string>();
  for (const ring of obstacle.rings) {
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

/**
 * Buildings, under the same rule the extruder draws.
 *
 * `solidBuildingFootprints` owns the parts-else-outline choice and the
 * `min_height` passable-underneath skip, so a gateway stays walkable and a
 * courtyard between parts stays open. Its rings are already lat/lng, which is
 * what keeps this module free of ENU.
 */
function addBuildings(
  features: readonly OsmFeature[],
  resolution: number,
  byCell: Map<string, Obstacle[]>,
): void {
  const solids = solidBuildingFootprints(features);
  // THE SECOND FEATURE SET THIS MODULE HAS EVER CONSULTED (DEC-R12-3), and the
  // reason is structural rather than incidental: `min_height` and
  // `building=roof` are readable from the building alone, while "a road goes
  // through here" is a property of the ROAD. Computed once for the whole
  // extract rather than per building.
  const openings = passageOpenings(features, solids);

  for (const [i, solid] of solids.entries()) {
    const { totalHeightM } = resolveHeights(solid.feature.tags);
    if (!Number.isFinite(totalHeightM) || totalHeightM <= 0) continue;

    const pierced = openings[i] ?? [];
    indexUnderCells(
      {
        feature: featureKey(solid.feature),
        heightM: totalHeightM,
        // EVERY RING, holes included. A courtyard's inner ring is a boundary an
        // agent crosses to get in, so dropping it would let one step from the
        // street into the yard without passing a wall.
        rings: solid.rings,
        // OMITTED WHEN EMPTY, so the common building carries no extra field and
        // `crossesObstacle` skips the check with one `undefined` test.
        ...(pierced.length > 0 ? { openings: pierced } : {}),
      },
      resolution,
      byCell,
    );
  }
}

/** Solid barriers, as `thicknessM`-wide bands along their centrelines. */
function addBarriers(
  features: readonly OsmFeature[],
  resolution: number,
  byCell: Map<string, Obstacle[]>,
): void {
  // THE SAME GATES `barrier-volumes.ts` BUILDS, from the same feature set
  // (DEC-R12-1). A gap indexed but not drawn is a detour around thin air; a gap
  // drawn but not indexed is an agent walking through a visible opening. Both
  // derive it from the list they are handed, so neither can forget.
  const gates = gateOpenings(features);

  for (const feature of features) {
    if (!isSolidBarrier(feature)) continue;

    const lines = barrierLines(feature, gates);
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

    indexUnderCells(
      { feature: featureKey(feature), heightM, rings },
      resolution,
      byCell,
    );
  }
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

/**
 * Whether a step from `fromCell` to `toCell` passes through solid geometry.
 *
 * **THIS IS WHAT MAKES A WALL BLOCK, and until it existed nothing did.**
 * `obstacleLevelsAt` only ever ADDS a standable level, so a walled cell offered
 * the ground and the wall top, and an agent walked along the ground straight
 * through the wall — `obstacles.test.ts` said as much in its header and called
 * this the next slice.
 *
 * **Blocking is a property of the STEP, not of the cell**, which is also how the
 * design phrases it ("does the segment between two points cross a wall?"). The
 * alternative — refusing to stand in a cell whose centre falls inside an
 * obstacle — cannot work at this resolution: a res-13 cell is ~8 m across and a
 * wall is ~0.5 m thick, so a wall contains a cell centre roughly one time in
 * sixteen and would be transparent to pathfinding the rest of the time.
 *
 * The segment runs between the two CELL CENTRES, which is the position an agent
 * in a cell is taken to occupy everywhere else in this module.
 *
 * **Obstacles are gathered from the whole `gridDisk(fromCell, 1)`, not from the
 * two cells.** A thin wall's footprint covers the cells the BAND passes
 * through, which need not be either endpoint: two neighbouring cells either
 * side of a wall can both be clear while the wall sits in the sliver between
 * their centres. Asking only the endpoints missed exactly that, and the miss
 * was silent — the wall indexed correctly and blocked nothing.
 *
 * **Defined for NEIGHBOURING cells**, which is all the search ever asks: every
 * candidate `columnSpace` generates comes from `gridDisk(state.cell, 1)`. For
 * cells further apart the segment can leave the disk and the answer is a lower
 * bound rather than a guarantee.
 */
export function crossesObstacle(
  index: ObstacleIndex,
  fromCell: string,
  toCell: string,
): boolean {
  if (fromCell === toCell) return false;

  const [fromLat, fromLng] = cellToLatLng(fromCell);
  const [toLat, toLng] = cellToLatLng(toCell);
  const a = { x: fromLng, y: fromLat };
  const b = { x: toLng, y: toLat };

  // DEDUPED BY IDENTITY, not by key: one obstacle routinely covers several of
  // these cells, and testing its rings again is pure cost on the search's
  // hottest path.
  const seen = new Set<Obstacle>();
  for (const cell of [...gridDisk(fromCell, 1), toCell]) {
    for (const obstacle of index.obstaclesIn(cell)) {
      if (seen.has(obstacle)) continue;
      seen.add(obstacle);
      for (const ring of obstacle.rings) {
        if (!segmentCrossesRing(a, b, ring)) continue;
        // A MAPPED OPENING ADMITS THE STEP THAT GOES THROUGH IT (DEC-R12-3).
        // Checked only AFTER a crossing was found, and only for the obstacles
        // that have one — almost none do — so the hot path pays one `undefined`
        // test per obstacle and nothing else.
        if (goesThroughAnOpening(a, b, obstacle)) continue;
        return true;
      }
    }
  }
  return false;
}

/**
 * Whether the step `a→b` passes close enough to one of `obstacle`'s openings to
 * be going through it.
 *
 * **A PROXIMITY TEST RATHER THAN A HOLE IN THE RING**, and that follows from the
 * primitive: `segmentCrossesRing` treats a ring as closed whether or not the
 * caller repeated the first vertex, so a building's boundary cannot be cut the
 * way `barrier-gates.ts` cuts a barrier centreline. It does not need to be —
 * a building's passability has always been an index-only property here
 * (`min_height` and `building=roof` volumes are drawn exactly as before and
 * simply do not obstruct), so the drawn-iff-indexed rule that forced the barrier
 * gap into the shared geometry does not apply.
 *
 * HALF A {@link GATE_GAP_M} either side, the same width a mapped gate opens: both
 * are "an opening a person walks through", and both are bounded from below by
 * the spacing of neighbouring res-13 cell centres — an opening the search cannot
 * step through is one that may as well not exist.
 */
function goesThroughAnOpening(
  a: PlanarPoint,
  b: PlanarPoint,
  obstacle: Obstacle,
): boolean {
  const openings = obstacle.openings;
  if (openings === undefined) return false;

  // DEGREES ARE ANISOTROPIC and this comparison is in metres, so longitude is
  // scaled by cos(latitude) before the distance is taken. Everything else in
  // this module is affine-invariant and needs no such correction; a RADIUS does.
  const latitude = ((a.y + b.y) / 2) * (Math.PI / 180);
  const scaleX = Math.cos(latitude);
  const limit = GATE_GAP_M / 2 / METRES_PER_DEGREE;

  for (const opening of openings) {
    const distance = pointToSegment(
      { x: opening.x * scaleX, y: opening.y },
      { x: a.x * scaleX, y: a.y },
      { x: b.x * scaleX, y: b.y },
    );
    if (distance <= limit) return true;
  }
  return false;
}

/** Metres in one degree of latitude. Good to ~0.5 % anywhere, which is plenty. */
const METRES_PER_DEGREE = 111_320;

/** Shortest distance from `p` to segment `a→b`, in the units given. */
function pointToSegment(
  p: PlanarPoint,
  a: PlanarPoint,
  b: PlanarPoint,
): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  // A zero-length step has no direction; the distance to its single point is the
  // only defensible answer.
  const t =
    lengthSquared === 0
      ? 0
      : Math.max(
          0,
          Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared),
        );
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}
