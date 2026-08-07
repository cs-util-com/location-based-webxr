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

import type { OsmFeature, OsmTags } from "../model/osm-feature.js";
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
  const value = feature.tags["barrier"];
  return value !== undefined && SOLID_BARRIERS.has(value);
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
  const fallback =
    tags["barrier"] === "city_wall"
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
