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
import { type GateOpenings, gateOpenings } from "../mesh/barrier-gates.js";
import {
  PASSAGE_CORRIDOR_M,
  insideRingsByParity,
  passageLines,
} from "./building-passages.js";
import {
  barrierCentrelines,
  isSolidBarrier,
  resolveBarrier,
} from "../mesh/barriers.js";
import { solidBuildingFootprints } from "../mesh/buildings.js";
import { resolveHeights } from "../mesh/building-heights.js";
import { enuFrameAt } from "../mesh/enu.js";
import { coverCells } from "../spatial/cell-coverage.js";
import { waterBankLines } from "../mesh/water.js";
import { isBridgeCrossing } from "../mesh/roads.js";
import type { Bbox } from "../spatial/clip.js";
import {
  segmentCrossesRing,
  segmentsIntersect,
} from "../spatial/segment-crossing.js";
import { AFFORDANCE_RES } from "../spatial/resolutions.js";
import { type PlanarPoint } from "../spatial/point-in-ring.js";

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
   * Lines along which this obstacle is open (DEC-R12-3) — today, the
   * `tunnel=building_passage` ways running through it.
   *
   * ABSENT ON ALMOST EVERYTHING, which is why it is optional rather than an
   * empty array everywhere: passages are common in a city extract and rare per
   * building, and `crossesObstacle` runs on the search's hottest path.
   *
   * **LINES, NOT THE MOUTHS.** A step is admitted when it runs along one of
   * these, which is a claim `crossesObstacle` can make about a step INSIDE the
   * footprint as well as about one crossing its boundary — and the inside is
   * where a corridor stops being a corridor if nobody asks. See
   * `building-passages.ts`.
   *
   * Degrees, `x = lng`, `y = lat`, exactly as {@link rings} are.
   */
  readonly passages?: readonly (readonly PlanarPoint[])[];
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

/** How the index may be bounded. */
export interface BuildObstacleIndexOptions {
  /**
   * Clip water geometry to this box before indexing its banks.
   *
   * **WATER ONLY, and deliberately not the whole feature set.** Barriers and
   * buildings are small — the largest in the corpus estimates at ~5 500 cells —
   * so they need no bound; water is the only class with kilometre-scale
   * geometry, because Overpass `out geom` returns whole member geometry
   * regardless of the query box.
   *
   * Clipping *everything* upstream would also be actively wrong: `clipToBbox`
   * can turn a way that leaves and re-enters the box into a `multilinestring`,
   * for which `barrierCentrelines` returns `[]` — an omission justified in that
   * file by the words *"clipping is not in this path"*. Doing it here, per
   * feature, keeps that true.
   *
   * A `Bbox`, **not a set of cells.** An H3 restriction would have to declare
   * its own resolution, and getting that wrong is silent: bounding res-7 tiles
   * with padding computed at res 13 yields a **16 m** box and an index with
   * almost nothing in it.
   */
  readonly clipWaterTo?: Bbox;
}

/**
 * Builds an index over the solid barriers, buildings AND water in `features`.
 *
 * Features that are none of those, and barriers whose geometry cannot make a
 * footprint, are skipped — a one-node way and an empty way are both ordinary
 * Overpass output.
 *
 * **Water is indexed as bands along its BANKS**, not as a filled surface, and
 * carries `heightM = 0`. See {@link addWater}.
 *
 * **Buildings follow the same parts-else-outline rule the extruder draws**
 * (`solidBuildingFootprints`), so what blocks an agent and what appears on
 * screen are the same set of volumes.
 */
export function buildObstacleIndex(
  features: Iterable<OsmFeature>,
  resolution: number = AFFORDANCE_RES,
  options: BuildObstacleIndexOptions = {},
): ObstacleIndex {
  const byCell = new Map<string, Obstacle[]>();
  const all = [...features];

  addBarriers(all, resolution, byCell);
  addBuildings(all, resolution, byCell);
  addWater(all, resolution, byCell, options.clipWaterTo, bridgeDeckLines(all));

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
  const passagesPerSolid = passageLines(features, solids);

  for (const [i, solid] of solids.entries()) {
    const { totalHeightM } = resolveHeights(solid.feature.tags);
    if (!Number.isFinite(totalHeightM) || totalHeightM <= 0) continue;

    const pierced = passagesPerSolid[i] ?? [];
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
        ...(pierced.length > 0 ? { passages: pierced } : {}),
      },
      resolution,
      byCell,
    );
  }
}

/**
 * How wide a bank band is, in metres.
 *
 * It exists only to give the bank a footprint the cover can file under; nothing
 * about the veto depends on the number, because `crossesObstacle` tests whether
 * a step crosses the band's ring rather than how thick it is. Half a metre is
 * `barriers.ts`'s own default for a wall, reused so the two do not drift for no
 * reason.
 */
const BANK_THICKNESS_M = 0.5;

/**
 * Water, as thin bands along its BANKS — never as a filled surface.
 *
 * Measured: filled-and-clipped costs 13 966–18 246 covered cells per site
 * against a **1 000–10 000 budget for a whole site's index**; banded-and-clipped
 * costs 1 153–1 517. See `site-water-index-cost.test.ts`.
 *
 * `heightM = 0`, which is exactly right and needs saying because it looks like a
 * placeholder: blocking here is **height-blind** (`crossesObstacle` never reads
 * `heightM`), while `obstacleLevelsAt` only ever ADDS a level. So a zero-height
 * obstacle blocks the crossing and offers nothing to stand on — a river with a
 * standable surface would be the whole point missed.
 *
 * **BRIDGES ARE EXEMPTED, since 2026-08-17** (PR #313 review). A bridge deck
 * crosses its river's banks, and `crossesObstacle` rejects any step crossing a
 * bank ring — so until the exemption was wired, every bridge over water was
 * unroutable, including `london-tower-bridge` in the shipped picker corpus. The
 * exemption is a PASSAGE rather than a hole: see {@link bridgeDeckLines}, and
 * note that `isBridgeCrossing` had existed with no production consumer for four
 * branches before this, which is why the warning below is kept in the past tense
 * rather than deleted.
 *
 * This paragraph used to end "Nothing calls this with water in the feature set
 * today, which is why that is tolerable". **That was false and is corrected
 * here**, because it is the sentence a future reader would have trusted:
 * `GpsPlusSlamJs_OsmDemo/src/worker/demo-worker.ts` builds the obstacle index
 * from `pipeline.features()` — the whole merged set — and `overpass-query.ts`
 * fetches `natural`, `water` and `waterway` including multipolygon relations.
 * So `natural=water water=river type=multipolygon` reaches this function on
 * every route request.
 *
 * **The fix is the bridge exemption, NOT switching water off.** Water vetoing a
 * route is deliberate and planned work, so making this opt-in and disabling it
 * would revert a decision rather than fix a defect — it would just trade
 * "bridges unroutable" for "agents walk on rivers". That fix is now in place, so
 * a river is a hard barrier to any agent EXCEPT along a ground-level deck.
 */
/**
 * The centrelines of every ground-level bridge deck in the extract.
 *
 * **These become PASSAGES on the water obstacles, not cuts in their bank
 * rings**, and that is forced rather than chosen: `segmentCrossesRing` treats a
 * ring as closed whether or not the caller repeated the first vertex, so a bank
 * ring cannot be opened the way `barrier-gates.ts` opens a barrier centreline.
 * The passage corridor `blockedDespitePassages` already implements is exactly
 * the right shape for a deck — "admitted exactly when the step runs along it".
 *
 * `isBridgeCrossing` carries the selector and its corpus evidence: at
 * `london-tower-bridge`, 14 of the 18 `bridge`-tagged ways are ground-level
 * decks. The 4 it rejects are structural areas and ways 43 m up behind a
 * turnstile — opening a bank along one of those would walk an agent onto a wall.
 *
 * Computed ONCE per index build, like `gateOpenings`, because it is a property
 * of the extract rather than of any one water feature.
 */
function bridgeDeckLines(
  features: readonly OsmFeature[],
): readonly (readonly PlanarPoint[])[] {
  const lines: (readonly PlanarPoint[])[] = [];
  for (const feature of features) {
    if (feature.type !== "way" || !isBridgeCrossing(feature)) continue;
    if (feature.geometry.length < 2) continue;
    lines.push(feature.geometry.map((p) => ({ x: p.lng, y: p.lat })));
  }
  return lines;
}

function addWater(
  features: readonly OsmFeature[],
  resolution: number,
  byCell: Map<string, Obstacle[]>,
  clipTo?: Bbox,
  bridges: readonly (readonly PlanarPoint[])[] = [],
): void {
  for (const feature of features) {
    const lines = waterBankLines(feature, clipTo);
    if (lines.length === 0) continue;

    // One ENU frame for the whole feature, anchored at its own first vertex —
    // the same rule `addBarriers` follows, and for the same reason: thickness is
    // metres, but the anchor belongs to the feature rather than to the view, so
    // the lat/lng it produces survive every recentre.
    const anchor = { lat: lines[0]![0]!.y, lng: lines[0]![0]!.x };
    const frame = enuFrameAt(anchor);

    const rings = lines.flatMap((line) => {
      const enuLine = line.map((p) => frame.toEnu({ lat: p.y, lng: p.x }));
      return barrierFootprints(enuLine, BANK_THICKNESS_M).map((ring) =>
        ring.map((v) => {
          const back = frame.toLatLng(v);
          return { x: back.lng, y: back.lat };
        }),
      );
    });
    if (rings.length === 0) continue;

    indexUnderCells(
      {
        feature: featureKey(feature),
        heightM: 0,
        rings,
        // EVERY DECK, NOT THE ONES THAT INTERSECT THIS RIVER. `passageLines`
        // filters per building because a building is small and passages are
        // many; here the asymmetry runs the other way — a city extract holds a
        // handful of decks — and `blockedDespitePassages` already requires the
        // step to be crossing or inside THIS obstacle before it looks at a
        // passage at all, so a distant deck cannot admit anything.
        ...(bridges.length > 0 ? { passages: bridges } : {}),
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
/**
 * Cell centres, memoised — the search asks for the same ones over and over.
 *
 * **Measured, not assumed.** `obstacles.bench.ts` prices a step at ~6.2 µs on
 * indexed cells and ~6.3 µs on cells with no obstacle anywhere in their disk —
 * i.e. **a step that runs no ring test at all costs the same**, so the bill is
 * the fixed per-call work rather than the geometry. Two `cellToLatLng` calls are
 * part of that floor, each allocating a fresh pair, and A\* asks about a given
 * cell once as `from` and up to six times as `to`.
 *
 * A cell id encodes its own resolution, so the id alone is a complete key —
 * the same reasoning `cell-overlap.ts`'s boundary memo uses.
 *
 * **The cached points are shared and must be treated as read-only.** Nothing
 * outside this module can reach them and `segmentCrossesRing` only reads, but a
 * future mutator would corrupt every later step silently, which is why this says
 * so rather than relying on it staying true.
 */
const centres = new Map<string, PlanarPoint>();

/**
 * Cap, in cells. Cleared wholesale rather than evicted one at a time — the same
 * choice, for the same reason, as `cell-overlap.ts`: a session walking across a
 * city grows this without limit, and an LRU here would be more machinery than
 * the thing it guards.
 */
const MAX_CACHED_CENTRES = 1 << 16;

function centreOf(cell: string): PlanarPoint {
  const cached = centres.get(cell);
  if (cached !== undefined) return cached;
  const [lat, lng] = cellToLatLng(cell);
  const point: PlanarPoint = { x: lng, y: lat };
  if (centres.size >= MAX_CACHED_CENTRES) centres.clear();
  centres.set(cell, point);
  return point;
}

export function crossesObstacle(
  index: ObstacleIndex,
  fromCell: string,
  toCell: string,
): boolean {
  if (fromCell === toCell) return false;

  const a = centreOf(fromCell);
  const b = centreOf(toCell);

  // DEDUPED BY IDENTITY, not by key: one obstacle routinely covers several of
  // these cells, and testing its rings again is pure cost on the search's
  // hottest path.
  //
  // The disk is MEMOISED and the `toCell` is visited separately rather than
  // spread into a fresh array with it: both allocated once per step, on a path
  // the search runs 20 000 times per click. `toCell` is usually already in the
  // disk, so it is often examined twice — which costs one map lookup and cannot
  // change the answer, because the dedupe below is by obstacle identity.
  const seen = new Set<Obstacle>();
  for (const cell of diskOf(fromCell)) {
    if (crossesAnyIn(index, cell, seen, a, b)) return true;
  }
  return crossesAnyIn(index, toCell, seen, a, b);
}

/**
 * Radius-1 disks, memoised alongside {@link centres} and for the same measured
 * reason: `gridDisk` allocates seven fresh strings per call, once per step.
 *
 * **The cached arrays are shared and must be treated as read-only.**
 */
const disks = new Map<string, string[]>();

function diskOf(cell: string): readonly string[] {
  const cached = disks.get(cell);
  if (cached !== undefined) return cached;
  const disk = gridDisk(cell, 1);
  if (disks.size >= MAX_CACHED_CENTRES) disks.clear();
  disks.set(cell, disk);
  return disk;
}

/** Whether any not-yet-seen obstacle in `cell` blocks the step `a → b`. */
function crossesAnyIn(
  index: ObstacleIndex,
  cell: string,
  seen: Set<Obstacle>,
  a: PlanarPoint,
  b: PlanarPoint,
): boolean {
  for (const obstacle of index.obstaclesIn(cell)) {
    if (seen.has(obstacle)) continue;
    seen.add(obstacle);
    // A MAPPED PASSAGE ADMITS THE STEPS THAT RUN ALONG IT, and refuses the
    // ones that do not — INCLUDING the ones that cross no boundary at all
    // (DEC-R12-3). Both halves are needed and neither is sufficient:
    //
    // - without the first, the passage is sealed and the tag does nothing;
    // - without the second, opening a mouth frees the whole INTERIOR, because
    //   `segmentCrossesRing` is false for a segment lying wholly inside a ring
    //   and `obstacleLevelsAt` never removes a cell's ground level. Before a
    //   building could be entered at all that was unobservable; an opening
    //   makes it reachable, and a route would cut a diagonal between two
    //   mouths through the rooms between them.
    //
    // Reached only for obstacles that HAVE passages — almost none do — so the
    // ordinary building pays one `undefined` test and nothing else.
    if (obstacle.passages !== undefined) {
      if (blockedDespitePassages(a, b, obstacle, obstacle.passages))
        return true;
      continue;
    }

    for (const ring of obstacle.rings) {
      if (segmentCrossesRing(a, b, ring)) return true;
    }
  }
  return false;
}

/**
 * Whether a step is blocked by an obstacle that has passages through it.
 *
 * The rule is one sentence: **the step is admitted exactly when it runs along a
 * passage.** Everything else about this obstacle blocks — a crossing of its
 * boundary elsewhere, and a step between two points inside it that is not on the
 * passage.
 *
 * **A PROXIMITY TEST RATHER THAN A HOLE IN THE RING**, and that follows from the
 * primitive: `segmentCrossesRing` treats a ring as closed whether or not the
 * caller repeated the first vertex, so a building's boundary cannot be cut the
 * way `barrier-gates.ts` cuts a barrier centreline. It does not need to be — a
 * building's passability has always been an index-only property here
 * (`min_height` and `building=roof` volumes are drawn exactly as before and
 * simply do not obstruct), so the drawn-iff-indexed rule that forced the barrier
 * gap into the shared geometry does not apply.
 *
 * HALF A {@link PASSAGE_CORRIDOR_M} either side. It is WIDER than a gate opens,
 * and that is not inconsistency: a gate needs one admitted step across a line,
 * a corridor needs a chain of them along its length, and the res-13 lattice the
 * search moves on has centres ~6 m apart. See `building-passages.ts`.
 */
function blockedDespitePassages(
  a: PlanarPoint,
  b: PlanarPoint,
  obstacle: Obstacle,
  passages: readonly (readonly PlanarPoint[])[],
): boolean {
  const crossesBoundary = obstacle.rings.some((ring) =>
    segmentCrossesRing(a, b, ring),
  );
  // Neither crossing the boundary nor inside it: this obstacle is simply not in
  // the way, and the passage is irrelevant.
  //
  // BY RING PARITY, via the one shared predicate. This was
  // `rings.some(ring => contains(a) && contains(b))` — "inside ANY ring" — and
  // that made a COURTYARD inside a pierced building unwalkable: a courtyard
  // point is inside the outer ring, so `inside` was true, so every step in the
  // yard was refused unless it happened to run along the passage.
  //
  // It disagreed with `insideFootprint` in `building-passages.ts`, whose
  // docstring rejects exactly this reading, and with the non-pierced path
  // below, which tests only for a CROSSING and therefore already lets
  // courtyards through. Three places, two answers.
  const inside =
    !crossesBoundary &&
    insideRingsByParity(a, obstacle.rings) &&
    insideRingsByParity(b, obstacle.rings);
  if (!crossesBoundary && !inside) return false;

  return !runsAlongAPassage(a, b, passages);
}

/** Whether the step `a→b` runs close enough to a passage to be going along it. */
function runsAlongAPassage(
  a: PlanarPoint,
  b: PlanarPoint,
  passages: readonly (readonly PlanarPoint[])[],
): boolean {
  // DEGREES ARE ANISOTROPIC and this comparison is in metres, so longitude is
  // scaled by cos(latitude) before the distance is taken. Everything else in
  // this module is affine-invariant and needs no such correction; a RADIUS does.
  const latitude = ((a.y + b.y) / 2) * (Math.PI / 180);
  const scaleX = Math.cos(latitude);
  const limit = PASSAGE_CORRIDOR_M / 2 / METRES_PER_DEGREE;
  const from = { x: a.x * scaleX, y: a.y };
  const to = { x: b.x * scaleX, y: b.y };

  // THE WHOLE STEP AGAINST THE WHOLE LINE, not the endpoints against the line.
  // A step is admitted when it stays within the corridor at some point along
  // its length — which is what an ENTRY step does (it begins outside the
  // building entirely) and what a step ALONG the corridor does. Requiring both
  // endpoints to be inside the corridor instead fails the entry step, and fails
  // a chain along the corridor whenever the H3 lattice puts two consecutive
  // centres on the same side of the line.
  for (const passage of passages) {
    for (let i = 0; i + 1 < passage.length; i++) {
      const p = passage[i]!;
      const q = passage[i + 1]!;
      const distance = segmentDistance(
        from,
        to,
        {
          x: p.x * scaleX,
          y: p.y,
        },
        { x: q.x * scaleX, y: q.y },
      );
      if (distance <= limit) return true;
    }
  }
  return false;
}

/** Shortest distance between two segments, in the units given. */
function segmentDistance(
  a: PlanarPoint,
  b: PlanarPoint,
  c: PlanarPoint,
  d: PlanarPoint,
): number {
  // Crossing segments are at distance zero, and the endpoint minimum below
  // would report the wrong thing for them.
  if (segmentsIntersect(a, b, c, d)) return 0;
  return Math.min(
    pointToSegment(a, c, d),
    pointToSegment(b, c, d),
    pointToSegment(c, a, b),
    pointToSegment(d, a, b),
  );
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
