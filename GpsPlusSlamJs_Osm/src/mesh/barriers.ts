/**
 * Barrier tags — which ones are solid, and how tall and thick they are.
 *
 * The navigation design's motivating complaint is an agent walking up the
 * Tower's curtain wall, and DEC-R7b-14 records that the obstacle set is wider
 * than `BuildingVolume`: barriers count, and they must be **drawn**, because an
 * NPC pathing around geometry the viewer cannot see demonstrates nothing.
 *
 * **The numbers here are decisions, not lookups.** OSM does not tell you how
 * tall an untagged wall is, and the owner settled it (DEC-R11-2): 2 m, hedges
 * solid, thickness from `width` falling back to a constant. The rejected
 * alternative was obstructing only where a height is explicitly tagged —
 * honest, but most walls are untagged, so the curtain wall would have stayed
 * passable and the demo would have shown nothing at the one place the session
 * complained about.
 *
 * @see barriers.ts.md
 */

import type { LatLng, OsmFeature, OsmTags } from "../model/osm-feature.js";
import { toGeometry } from "../model/osm-geometry.js";
import { type GateOpenings, splitAtGates } from "./barrier-gates.js";
import { parseLengthMetres } from "./building-heights.js";

/**
 * Barrier values a person cannot walk through.
 *
 * AN EXPLICIT LIST, not a pattern. `barrier=*` covers gates, kerbs and bollards
 * as well as walls, and the two failure directions are both silent: too narrow
 * a set leaves the wall walkable, too wide a one turns every gate into an
 * obstacle — which reads as broken pathfinding rather than as a tagging call.
 *
 * `wall` and `hedge` are the owner's (DEC-R11-2). The wall variants and `fence`
 * follow from the same question, since you cannot walk through any of them.
 */
const SOLID_BARRIERS = new Set([
  "wall",
  "city_wall",
  "retaining_wall",
  "fence",
  "hedge",
]);

/**
 * Height of a solid barrier with no `height` tag, metres (DEC-R11-2).
 *
 * Well clear of `STEP_THRESHOLD_M`, so a default-height barrier is an obstacle
 * rather than a step — which is the entire point of having a default at all.
 */
export const DEFAULT_BARRIER_HEIGHT_M = 2;

/**
 * Height of an untagged `barrier=city_wall`, metres.
 *
 * TALLER THAN THE GENERAL DEFAULT, and deliberately: the design's motivating
 * example is an 8 m curtain wall, and a 2 m city wall would be wrong in the one
 * case this feature exists for. A tagged `height` still wins.
 */
export const DEFAULT_CITY_WALL_HEIGHT_M = 6;

/**
 * Thickness of a barrier with no `width` tag, metres (DEC-R11-2).
 *
 * A brick wall is ~0.3 m and a curtain wall several times that; this sits in
 * between. It exists mostly so the drawn geometry has an extent — a zero-width
 * quad is invisible edge-on, and an obstacle you cannot see is the thing
 * DEC-R7b-14 rules out.
 */
export const DEFAULT_BARRIER_THICKNESS_M = 0.5;

/** What a barrier occupies. */
export interface BarrierDimensions {
  readonly heightM: number;
  readonly thicknessM: number;
}

/**
 * Whether this feature is a barrier an agent cannot pass through.
 *
 * **Nodes are never barriers here.** A node has no extent to obstruct, and
 * `barrier=gate` on a node is the common tagging — a zero-length wall is not a
 * wall.
 *
 * **An unknown `barrier` value is passable.** Failing towards passable is the
 * cheaper error: an invented obstacle produces a detour with no visible cause,
 * which reads as a pathfinding bug, while a missed one at least looks like what
 * it is.
 */
export function isSolidBarrier(feature: OsmFeature): boolean {
  if (feature.type === "node") return false;
  if (isCityWall(feature.tags)) return true;
  const value = feature.tags["barrier"];
  return value !== undefined && SOLID_BARRIERS.has(value);
}

/**
 * A city wall under either of the two tags OSM uses for one.
 *
 * **`historic=citywalls` carries no `barrier` tag**, which is not a guess: all
 * four such ways in the checked-in Cologne extract are tagged that way and only
 * that way. Keying the solid set solely on `barrier=*` therefore dropped every
 * one of them — and a city wall is the design's motivating example, so the one
 * feature the work exists for was the one it could not see. Measured rather
 * than assumed; `site-barriers.test.ts` asserts it against the real extract.
 *
 * NARROW ON PURPOSE. `historic=castle` stays out: a castle outline is a
 * building question, and treating it as a barrier would trace a solid band
 * around the whole bailey — the inverse failure the design calls the louder one.
 */
function isCityWall(tags: OsmTags): boolean {
  return tags["barrier"] === "city_wall" || tags["historic"] === "citywalls";
}

/** The solid barrier kinds, each with its own untagged size and colour. */
export type BarrierKind =
  "wall" | "city_wall" | "retaining_wall" | "fence" | "hedge";

/**
 * The untagged size of each kind, metres (city objects plan 2026-11-07-2315
 * M1). THE ONE SOURCE: navigation and drawing both read it through
 * `resolveBarrier`, so a fence is never drawn 1.2 m tall and indexed as 2 m.
 *
 * - wall and hedge 2 m: the owner's (DEC-R11-2); fence 1.2 m: the owner's;
 * - city wall 6 m: `DEFAULT_CITY_WALL_HEIGHT_M`;
 * - retaining wall 1 m (session): it holds a slope rather than standing free,
 *   and 1 m is still an obstacle above `STEP_THRESHOLD_M` (0.5 m); this
 *   lowers DEC-R11-2's 2 m for it in navigation too;
 * - every thickness (session, the O1 lab's guesses): hedge 0.8, wall and
 *   retaining wall 0.4, city wall 1.2, fence 0.12. The navigation veto is a
 *   segment crossing, blind to thickness, so thickness moves the drawing and
 *   the cells a barrier covers only.
 *
 * A `Map`, so a prototype name as a `barrier` value finds nothing.
 */
const BARRIER_SIZES: ReadonlyMap<BarrierKind, BarrierDimensions> = new Map([
  ["hedge", { heightM: DEFAULT_BARRIER_HEIGHT_M, thicknessM: 0.8 }],
  ["wall", { heightM: DEFAULT_BARRIER_HEIGHT_M, thicknessM: 0.4 }],
  ["city_wall", { heightM: DEFAULT_CITY_WALL_HEIGHT_M, thicknessM: 1.2 }],
  ["retaining_wall", { heightM: 1, thicknessM: 0.4 }],
  ["fence", { heightM: 1.2, thicknessM: 0.12 }],
]);

/**
 * Which solid kind a feature's tags name, or `undefined`. A city wall under
 * either tag (`isCityWall`) wins over its `barrier` value.
 */
export function barrierKind(tags: OsmTags): BarrierKind | undefined {
  if (isCityWall(tags)) return "city_wall";
  const value = tags["barrier"] ?? "";
  return SOLID_BARRIERS.has(value) ? (value as BarrierKind) : undefined;
}

/**
 * A barrier's height and thickness in metres, both guaranteed finite and
 * positive.
 *
 * Tagged `height` and `width` win; otherwise the kind's size
 * (`BARRIER_SIZES`), and for tags of no known kind the 2 m and 0.5 m
 * constants.
 *
 * THAT GUARANTEE IS LOAD-BEARING. A non-finite height reaching the column model
 * makes every step involving it non-adjacent — an invisible wall sealing off
 * the feature, with nothing on screen to explain it. `height=tall` and
 * `height=` are both real tagging, so this is a live path rather than a
 * defensive formality.
 */
export function resolveBarrier(tags: OsmTags): BarrierDimensions {
  const kind = barrierKind(tags);
  const fallback = (kind === undefined
    ? undefined
    : BARRIER_SIZES.get(kind)) ?? {
    heightM: DEFAULT_BARRIER_HEIGHT_M,
    thicknessM: DEFAULT_BARRIER_THICKNESS_M,
  };

  return {
    heightM: positiveOr(parseLengthMetres(tags["height"]), fallback.heightM),
    thicknessM: positiveOr(
      parseLengthMetres(tags["width"]),
      fallback.thicknessM,
    ),
  };
}

/** The parsed value when it is finite and above zero, else the fallback. */
function positiveOr(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}

/**
 * Every lat/lng line a barrier feature runs along, with mapped gates opened.
 *
 * **ONE DEFINITION, TWO CONSUMERS.** `nav/obstacles.ts` indexes these lines and
 * `barrier-volumes.ts` draws them, and the two must agree exactly: a wall drawn
 * where nothing is indexed is an agent walking through a visible wall, and a
 * wall indexed where nothing is drawn is a detour around thin air. Both are
 * bugs a reader would diagnose in the wrong file, so the geometry decision lives
 * here rather than in either of them.
 *
 * **`gates` IS REQUIRED, AND THAT IS THE POINT** (DEC-R12-1). A gap cut in the
 * drawn band but not in the index is an agent detouring through a visible
 * opening; a gap cut in the index but not in the band is an agent walking
 * through a visible wall. Making the argument optional would let one consumer
 * quietly omit it — the exact drift this function exists to prevent — so a
 * caller with no feature list passes {@link NO_GATES} explicitly and says so.
 *
 * **A LIST, because a multipolygon has PARTS.** An earlier version took
 * `polygons[0][0]`: the inner index correctly ignores holes, but the outer one
 * silently discarded `polygons[1..]` — disjoint parts of the same barrier, not
 * holes. One part was indexed and the other was invisible, which is precisely
 * the "a barrier the index simply did not see" failure the multipolygon branch
 * was added to remove. Raised in review on #260.
 *
 * Empty when nothing usable is there — a one-node way and an empty way are both
 * ordinary Overpass output rather than errors.
 */
export function barrierCentrelines(
  feature: OsmFeature,
  gates: GateOpenings,
): readonly (readonly LatLng[])[] {
  const result = toGeometry(feature);
  if (!result.ok) return [];

  const geometry = result.geometry;
  // MULTIPOLYGON IS HANDLED, not silently dropped (#259). A `barrier=wall`
  // mapped as a multipolygon relation is rare, but it is neither "not a
  // barrier" nor "unusable geometry" — it would have been a barrier the index
  // simply did not see, which is the one skip reason with no stated rationale.
  //
  // OUTER RINGS ONLY, and ALL of them — but NOT because holes must stay closed.
  // Every ring here is a CENTRELINE: `barrierFootprints` emits one
  // `thicknessM`-wide quad per segment, so what becomes solid is a ~0.5 m band
  // along the ring itself and the interior is walkable whether or not the inner
  // rings are read. An area-mapped barrier is therefore treated as a wall along
  // its OUTLINE, not as a filled region.
  //
  // What that costs, stated rather than implied (#263): an area-mapped
  // `barrier=city_wall` is normally outer = outer face, inner = inner face, with
  // the wall material between them. This puts a default-thickness band on the
  // outer face and ignores the inner one. Disjoint outers are all used — those
  // are PARTS of one barrier, not holes (#260).
  //
  // `multilinestring` is deliberately absent. `toGeometry` never produces one —
  // only `clip.ts` does, and clipping is not in this path — so a branch for it
  // would be code no test could ever cover (#260). The `[0]` assertions below
  // are there for the same reason the `multilinestring` branch is not: both
  // `wayToGeometry` (`rings: [way.geometry]`) and `relationToGeometry`
  // (`polygons[0]!`, seeded `[outer]` by `groupRingsIntoPolygons`) always
  // produce an outer ring, so a `?? []` fallback would be a branch no test can
  // cover and no mutant can be killed on (#263).
  const lines: readonly (readonly LatLng[])[] =
    geometry.kind === "linestring"
      ? [geometry.positions]
      : geometry.kind === "polygon"
        ? [geometry.rings[0]!]
        : geometry.kind === "multipolygon"
          ? geometry.polygons.map((polygon) => polygon[0]!)
          : [];

  // A single node has no direction, so it can be neither drawn nor indexed.
  // Filtered BEFORE the gate split, so `splitAtGates` never sees a degenerate
  // line, and again inside it, since a piece swallowed by its own gate is gone
  // and a piece shorter than this barrier is thick is not a barrier.
  const { thicknessM } = resolveBarrier(feature.tags);
  return lines
    .filter((line) => line.length >= 2)
    .flatMap((line) => splitAtGates(line, gates, thicknessM));
}
