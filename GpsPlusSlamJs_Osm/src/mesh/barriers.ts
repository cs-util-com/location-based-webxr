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

/**
 * A barrier's height and thickness in metres, both guaranteed finite and
 * positive.
 *
 * THAT GUARANTEE IS LOAD-BEARING. A non-finite height reaching the column model
 * makes every step involving it non-adjacent — an invisible wall sealing off
 * the feature, with nothing on screen to explain it. `height=tall` and
 * `height=` are both real tagging, so this is a live path rather than a
 * defensive formality.
 */
export function resolveBarrier(tags: OsmTags): BarrierDimensions {
  const fallback = isCityWall(tags)
    ? DEFAULT_CITY_WALL_HEIGHT_M
    : DEFAULT_BARRIER_HEIGHT_M;

  return {
    heightM: positiveOr(parseLengthMetres(tags["height"]), fallback),
    thicknessM: positiveOr(
      parseLengthMetres(tags["width"]),
      DEFAULT_BARRIER_THICKNESS_M,
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
 * Every lat/lng line a barrier feature runs along.
 *
 * **ONE DEFINITION, TWO CONSUMERS.** `nav/obstacles.ts` indexes these lines and
 * `barrier-volumes.ts` draws them, and the two must agree exactly: a wall drawn
 * where nothing is indexed is an agent walking through a visible wall, and a
 * wall indexed where nothing is drawn is a detour around thin air. Both are
 * bugs a reader would diagnose in the wrong file, so the geometry decision lives
 * here rather than in either of them.
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
  return lines.filter((line) => line.length >= 2);
}
