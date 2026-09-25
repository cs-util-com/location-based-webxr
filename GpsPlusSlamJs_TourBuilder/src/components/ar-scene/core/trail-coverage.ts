/**
 * Trail coverage check (plan 2026-09-17): does a waypoint have real,
 * physically-recorded breadcrumb trail nearby, or was it placed (drag/tap on
 * the authoring map) with no corresponding GPS trail ever recorded near it?
 *
 * Pure view-time derivation over the flat breadcrumb polyline (contract D7)
 * — no `tour.json`/`Waypoint` schema change. Stays in world-space X/Z
 * (`HorizontalPoint`, contract D17) rather than raw lat/lon: this runs at
 * viewing time, where CLAUDE.md's "no geo math in scene logic" rule applies
 * (the lat/lon exception is authoring-time only, AU2).
 *
 * @see plans/2026-09-17-trail-coverage-plan.md
 */

import type { HorizontalPoint } from "./trail-window.js";

/** At the 3 m breadcrumb sample spacing (`MIN_BREADCRUMB_DISTANCE_M`), 10
 *  points ≈ 30 m of continuous nearby trail — a "this is a real stretch, not
 *  noise" floor. Tunable. */
export const MIN_TRAIL_COVERAGE_COUNT = 10;

/**
 * True once at least `minCount` of `points` fall within `radiusM` (horizontal
 * X/Z, D17) of `waypointPos`. `null` entries (not yet convertible to world
 * space) are skipped, same convention as `selectTrailWindow`. Early-exits as
 * soon as the count is reached.
 */
export function hasNearbyTrail(
  waypointPos: HorizontalPoint,
  points: readonly (HorizontalPoint | null)[],
  radiusM: number,
  minCount: number = MIN_TRAIL_COVERAGE_COUNT,
): boolean {
  const radiusSq = radiusM * radiusM;
  let count = 0;
  for (const p of points) {
    if (p === null) continue;
    const dx = p.x - waypointPos.x;
    const dz = p.z - waypointPos.z;
    if (dx * dx + dz * dz <= radiusSq) {
      count++;
      if (count >= minCount) return true;
    }
  }
  return false;
}
