/**
 * Invented roofs for the buildings the map says nothing about: the plan per
 * building (`planInventedRoofs`) and its mesh (`inventedRoofMesh`).
 *
 * The decisions are `roofscape-rules.ts`'s; this file runs them over a whole
 * set of footprints (the neighbourhood prior and the shared walls need the
 * neighbours) and turns each answer into a roof. Two kinds of plan:
 *
 * - `"roof"`: a skeleton roof standing on the eave ring, past the walls by the
 *   overhang except on gables and shared walls, gables on chosen wing ends,
 *   its slope flattened before it rises more than `maxRiseM`, and cut flat
 *   above that on a deep building.
 * - `"lid"`: walls and a flat lid, for a building refused a roof (by class,
 *   size or neighbourhood) or one no sound skeleton fits; its height is the
 *   rules' refused height.
 *
 * ONE PLANNER FOR DRAWING AND NAVIGATION. `buildBuildings` draws these plans
 * and the obstacle index takes its heights from the same plans
 * (`inventedRoofTotals`), so an agent never walks through a roof the screen
 * draws or stops at one it does not.
 *
 * @see invented-roofs.ts.md
 */

import type { OsmFeatureKey, OsmTags } from "../model/osm-feature.js";
import { parseLengthMetres } from "./building-heights.js";
import type { EnuPoint } from "./enu.js";
import { isCounterClockwise, signedArea2 } from "./enu.js";
import type { ExtrudedBuilding } from "./extrude.js";
import { MeshBuilder } from "./mesh-data.js";
import type { SkeletonRoof } from "./roof-skeleton.js";
import { skeletonRoof, wingEnds } from "./roof-skeleton.js";
import {
  chooseGableEnds,
  inventedEaveHeightM,
  inventedRoofRefusal,
  isSacred,
  keepReason,
  neighbourhoodPriors,
  offsetRing,
  ROOFSCAPE_DEFAULTS,
  refusedHeightM,
  sharedWalls,
  simplifyRing,
} from "./roofscape-rules.js";
import type {
  OwnedSegment,
  PriorEntry,
  RoofscapeParams,
} from "./roofscape-rules.js";
import { skeletonMesh } from "./skeleton-mesh.js";
import { mixedUnit } from "./stable-jitter.js";
import { dropClosingPoint } from "./triangulate.js";
import { addWalls } from "./walls.js";

/** One building or part as the planner sees it, in ENU metres. */
export interface InventedFootprint {
  readonly key: OsmFeatureKey;
  readonly tags: OsmTags;
  /** A point inside the footprint: its place in the neighbourhood. */
  readonly at: EnuPoint;
  /** Every polygon, outer ring first, then holes; either winding. */
  readonly polygons: readonly (readonly (readonly EnuPoint[])[])[];
  /** For a part: the outline it was assigned to. */
  readonly outlineKey?: OsmFeatureKey;
  /**
   * For an outline: whether any `building:part` was assigned to it, or it is
   * not drawn because what stands inside it fills it. Such an outline is kept.
   */
  readonly hasParts: boolean;
}

/** A building refused a roof, or one no sound roof fits: a flat lid. */
export interface InventedLid {
  readonly kind: "lid";
  /** Why: a refusal of `inventedRoofRefusal`, or "no sound roof". */
  readonly why: string;
  /** Walls and lid, metres above the building's base. */
  readonly heightM: number;
}

/** A building with an invented roof. */
export interface InventedRoof {
  readonly kind: "roof";
  /** "gable", "shared" (vertical on shared walls only), "hip" or "cut". */
  readonly style: "gable" | "shared" | "hip" | "cut";
  /** The walls: simplified, outer counter-clockwise, holes clockwise. */
  readonly rings: readonly (readonly EnuPoint[])[];
  /** The rings the roof stands on, corner for corner `rings` or past them. */
  readonly roofRings: readonly (readonly EnuPoint[])[];
  readonly roof: SkeletonRoof;
  /** Rise over run of every slope. */
  readonly tan: number;
  /** Wall height above the base, metres. */
  readonly eaveM: number;
  /** The ridge (or the cut top) above the base, metres. */
  readonly totalM: number;
}

export type InventedPlan = InventedLid | InventedRoof;

/** The building's top above its base, as the obstacle index needs it. */
export function inventedTotalM(plan: InventedPlan): number {
  return plan.kind === "lid" ? plan.heightM : plan.totalM;
}

/**
 * The plans for every footprint that takes an invented roof or lid, by key.
 *
 * Only an outline with ONE polygon is planned: a multipolygon building keeps
 * the library's volume (its wings would each need a plan and a shared
 * height). Every footprint, planned or not, counts as a neighbour: its tags
 * vote in the prior and its walls can be shared.
 */
export function planInventedRoofs(
  footprints: readonly InventedFootprint[],
  params: RoofscapeParams = ROOFSCAPE_DEFAULTS,
): Map<OsmFeatureKey, InventedPlan> {
  const entries: PriorEntry[] = footprints.map((f) => ({
    key: f.key,
    tags: f.tags,
    at: f.at,
    ...(f.outlineKey === undefined ? {} : { outlineKey: f.outlineKey }),
  }));
  const priors = neighbourhoodPriors(entries, params);
  const walls = new SegmentGrid(footprints);
  const plans = new Map<OsmFeatureKey, InventedPlan>();
  for (const footprint of footprints) {
    const plan = planOne(footprint, priors, walls, params);
    if (plan !== undefined) plans.set(footprint.key, plan);
  }
  return plans;
}

function planOne(
  footprint: InventedFootprint,
  priors: ReturnType<typeof neighbourhoodPriors>,
  walls: SegmentGrid,
  params: RoofscapeParams,
): InventedPlan | undefined {
  const { key, tags, polygons } = footprint;
  if (footprint.outlineKey !== undefined || polygons.length !== 1) {
    return undefined;
  }
  const reason = keepReason(tags, {
    hasParts: footprint.hasParts,
    belowSurface: false,
    heightLimitM: params.heightLimitM,
  });
  if (reason !== undefined) return undefined;
  const given = polygons[0] ?? [];
  const area = Math.abs(signedArea2(dropClosingPoint(given[0] ?? []))) / 2;
  if (!(area > 0)) return undefined;
  const prior = priors.get(key);
  const why = inventedRoofRefusal(tags, area, prior, params);
  if (why !== undefined) {
    return {
      kind: "lid",
      why,
      heightM: refusedHeightM(tags, area, key, prior, params),
    };
  }
  const rings = orientedRings(given, params.simplifyToleranceM);
  if (rings === undefined) return undefined;
  const outer = rings[0] as EnuPoint[];
  const shared = sharedWalls(outer, key, walls.near(outer), params);
  const sacred = isSacred(tags);
  const tan = sacred
    ? params.sacredTan
    : params.tanMin +
      mixedUnit(key, "roofscape-pitch") * (params.tanMax - params.tanMin);
  const wantsGable =
    sacred || mixedUnit(key, "roofscape-gable") < params.gableShare;
  const best = bestRoof(rings, shared, { wantsGable, tan }, params);
  const eave = inventedEaveHeightM(tags, area, key);
  if (best === undefined) {
    return { kind: "lid", why: "no sound roof", heightM: eave };
  }
  const rise = best.roof.ridgeT * best.tan;
  // A stated height is the whole building: the roof fits inside it.
  const stated = parseLengthMetres(tags["height"]);
  const eaveM =
    stated !== undefined && stated > 0 ? Math.max(2, stated - rise) : eave;
  return { kind: "roof", rings, ...best, eaveM, totalM: eaveM + rise };
}

/**
 * The rings without a closing point, simplified, outer counter-clockwise and
 * holes clockwise (the side `offsetRing` moves a wall to is then always away
 * from the building). Undefined when a ring keeps fewer than three corners.
 */
function orientedRings(
  rings: readonly (readonly EnuPoint[])[],
  toleranceM: number,
): EnuPoint[][] | undefined {
  const out: EnuPoint[][] = [];
  for (const [r, ring] of rings.entries()) {
    const simple = simplifyRing(dropClosingPoint(ring), toleranceM);
    if (simple.length < 3) return undefined;
    out.push(
      isCounterClockwise(simple) === (r === 0) ? simple : simple.reverse(),
    );
  }
  return out;
}

interface BestRoof {
  readonly style: InventedRoof["style"];
  readonly roofRings: readonly (readonly EnuPoint[])[];
  readonly roof: SkeletonRoof;
  readonly tan: number;
}

/**
 * The most house-like roof the footprint takes: vertical on shared walls
 * (else none), gables on chosen wing ends when the house wants them and the
 * run stays sound, all on the eave ring (else on the walls). The slope
 * flattens until the rise is at most `maxRiseM`; below `tanFloor` the roof is
 * cut flat at `maxRiseM` instead. Undefined when no run is sound.
 */
function bestRoof(
  rings: readonly (readonly EnuPoint[])[],
  shared: readonly boolean[],
  house: { readonly wantsGable: boolean; readonly tan: number },
  params: RoofscapeParams,
): BestRoof | undefined {
  const sharedSet = new Set<number>();
  shared.forEach((is, i) => {
    if (is) sharedSet.add(i);
  });
  const run = (
    over: readonly (readonly EnuPoint[])[],
    zero: ReadonlySet<number>,
    maxT?: number,
  ): SkeletonRoof | undefined => {
    try {
      const roof = skeletonRoof(over, {
        weights: over.map((ring, r) =>
          ring.map((_, i) => (r === 0 && zero.has(i) ? 0 : 1)),
        ),
        ...(maxT === undefined ? {} : { maxT }),
      });
      return roof.ridgeT > 0 ? roof : undefined;
    } catch {
      // Any failure means "not this run": the next one, or a lid, follows.
      return undefined;
    }
  };

  let zero: ReadonlySet<number> = sharedSet;
  let roof = run(rings, zero);
  if (roof === undefined && zero.size > 0) {
    zero = new Set();
    roof = run(rings, zero);
  }
  if (roof === undefined) return undefined;
  let style: InventedRoof["style"] = zero.size > 0 ? "shared" : "hip";
  if (house.wantsGable) {
    const ends = chooseGableEnds(
      wingEnds(roof),
      rings[0] ?? [],
      shared,
      params,
    );
    if (ends.size > 0) {
      const withEnds = new Set([...zero, ...ends]);
      if (run(rings, withEnds) !== undefined) {
        zero = withEnds;
        style = "gable";
      }
    }
  }

  const finish = (
    over: readonly (readonly EnuPoint[])[],
  ): BestRoof | undefined => {
    const whole = run(over, zero);
    if (whole === undefined) return undefined;
    const fitted = Math.min(house.tan, params.maxRiseM / whole.ridgeT);
    if (fitted >= params.tanFloor) {
      return { style, roofRings: over, roof: whole, tan: fitted };
    }
    // Too wide for a whole roof: slopes up to the limit, a flat top after it.
    const cut = run(over, sharedSet, params.maxRiseM / params.tanFloor);
    if (cut === undefined) return undefined;
    return { style: "cut", roofRings: over, roof: cut, tan: params.tanFloor };
  };
  const eaved = eaveRings(rings, zero, params.overhangM);
  return (eaved === undefined ? undefined : finish(eaved)) ?? finish(rings);
}

/** The rings the eaves follow: slopes reach past the wall, gables do not. */
function eaveRings(
  rings: readonly (readonly EnuPoint[])[],
  zero: ReadonlySet<number>,
  overhangM: number,
): EnuPoint[][] | undefined {
  if (!(overhangM > 0)) return undefined;
  const out: EnuPoint[][] = [];
  for (const [r, ring] of rings.entries()) {
    const moved = offsetRing(
      ring,
      ring.map((_, i) => (r === 0 && zero.has(i) ? 0 : overhangM)),
    );
    if (moved === undefined) return undefined;
    out.push(moved);
  }
  return out;
}

/**
 * The mesh of an invented roof on its building's ground: walls from the base
 * to the eave, the roof's slopes and caps (the roof range), its gables, and
 * the eave's underside from wall to roof edge, facing down. `ground` is the
 * building's `{ lowest, rise }`, as `buildBuildings` computes it: the walls
 * run down to the lowest ground and the eave stays above the highest.
 */
export function inventedRoofMesh(
  plan: InventedRoof,
  ground: { readonly lowest: number; readonly rise: number },
): ExtrudedBuilding {
  const base = ground.lowest;
  const eave = ground.lowest + ground.rise + plan.eaveM;
  const builder = new MeshBuilder();
  plan.rings.forEach((ring, r) => {
    addWalls(builder, ring, base, eave, r === 0);
  });
  const roof = skeletonMesh(plan.roof, { eaveM: eave, slope: plan.tan });
  const roofStart = builder.vertexCount;
  builder.append(roof.mesh);
  addSoffits(builder, plan, eave);
  return {
    ...builder.build(roof.mesh.forcedEars),
    roofIsApproximate: false,
    roofVertices: { start: roofStart, end: roofStart + roof.surfaceVertices },
    roofMethod: "skeleton",
  };
}

/** Below this, in square metres, a soffit triangle is a sliver: skipped. */
const SLIVER_M2 = 1e-6;

/**
 * The eave's underside, wall line to roof edge, facing the ground. A gable or
 * shared wall has no overhang, so its quad has no area and is skipped.
 */
function addSoffits(
  builder: MeshBuilder,
  plan: InventedRoof,
  eave: number,
): void {
  plan.rings.forEach((ring, r) => {
    const over = plan.roofRings[r];
    if (over === undefined || over === ring) return;
    ring.forEach((a, i) => {
      const next = (i + 1) % ring.length;
      const b = ring[next] as EnuPoint;
      const c = over[next] as EnuPoint;
      const d = over[i] as EnuPoint;
      downward(builder, a, b, c, eave);
      downward(builder, a, c, d, eave);
    });
  });
}

/** One horizontal triangle at `heightM`, wound to face down. */
function downward(
  builder: MeshBuilder,
  a: EnuPoint,
  b: EnuPoint,
  c: EnuPoint,
  heightM: number,
): void {
  const twice = (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y);
  if (!(Math.abs(twice) / 2 > SLIVER_M2)) return;
  // Counter-clockwise in (east, north) faces down once the builder turns the
  // frame Y-up; see `addCap` in `extrude.ts`.
  const [p, q] = twice > 0 ? [b, c] : [c, b];
  builder.triangle(
    builder.vertex(a.x, heightM, a.y, 0, -1, 0),
    builder.vertex(p.x, heightM, p.y, 0, -1, 0),
    builder.vertex(q.x, heightM, q.y, 0, -1, 0),
  );
}

/** Cell size of the wall grid: a house or two across. */
const WALL_CELL_M = 16;
/** Wider than any shared-wall gap: only a pre-filter. */
const NEIGHBOUR_REACH_M = 1;

/** Every wall of every footprint, found by the cells its box touches. */
class SegmentGrid {
  private readonly cells = new Map<string, OwnedSegment[]>();

  constructor(footprints: readonly InventedFootprint[]) {
    for (const f of footprints) {
      for (const polygon of f.polygons) {
        for (const ring of polygon) {
          const open = dropClosingPoint(ring);
          open.forEach((a, i) => {
            const b = open[(i + 1) % open.length] as EnuPoint;
            const segment = { a, b, owner: f.key };
            for (const cell of this.cellsOf([a, b], NEIGHBOUR_REACH_M)) {
              const list = this.cells.get(cell);
              if (list === undefined) this.cells.set(cell, [segment]);
              else list.push(segment);
            }
          });
        }
      }
    }
  }

  /** The walls whose box comes within reach of `ring`'s box (a superset). */
  near(ring: readonly EnuPoint[]): OwnedSegment[] {
    const found = new Set<OwnedSegment>();
    for (const cell of this.cellsOf(ring, 0)) {
      for (const segment of this.cells.get(cell) ?? []) found.add(segment);
    }
    return [...found];
  }

  private cellsOf(points: readonly EnuPoint[], grow: number): string[] {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of points) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    if (![minX, minY, maxX, maxY].every(Number.isFinite)) return [];
    const out: string[] = [];
    const c = (v: number) => Math.floor(v / WALL_CELL_M);
    for (let x = c(minX - grow); x <= c(maxX + grow); x++) {
      for (let y = c(minY - grow); y <= c(maxY + grow); y++) {
        out.push(`${x},${y}`);
      }
    }
    return out;
  }
}
