/**
 * Nearest-unvisited-breadcrumb selection (plan 2026-09-17-breadcrumb-wayfinding).
 *
 * Distinct from `selectNextUnvisitedWaypoint` (store/selectors.ts), which
 * walks tour order (D8) over waypoints. This is distance-nearest, over
 * breadcrumbs, which have no stable id (D7) — keyed by array index, same
 * convention `trail-window.ts` uses.
 *
 * One-way latch (BW3): a visited index is a permanent fact, never re-checked
 * against a hysteresis margin. Re-picks `next` in the same call when arrival
 * triggers (BW4), so the guide advances immediately rather than pointing at
 * the spot the visitor is already standing on for one extra tick.
 */

import type { HorizontalPoint } from "./trail-window.js";

interface NearestResult {
  readonly index: number;
  readonly distSq: number;
}

function nearestUnvisited(
  points: readonly (HorizontalPoint | null)[],
  isExcluded: (index: number) => boolean,
  userPos: HorizontalPoint,
): NearestResult | null {
  let best: NearestResult | null = null;
  for (let i = 0; i < points.length; i++) {
    if (isExcluded(i)) continue;
    const p = points[i];
    if (p === null || p === undefined) continue;
    const dx = p.x - userPos.x;
    const dz = p.z - userPos.z;
    const distSq = dx * dx + dz * dz;
    if (best === null || distSq < best.distSq) {
      best = { index: i, distSq };
    }
  }
  return best;
}

export function advanceBreadcrumbProgress(
  points: readonly (HorizontalPoint | null)[],
  visited: ReadonlySet<number>,
  userPos: HorizontalPoint | null,
  arrivalRadiusM: number,
): {
  next: number | null;
  newlyVisited: number | null;
  /** Horizontal dist² (m²) from `userPos` to `next`, or `null` alongside a
   *  `null` `next` — lets a caller decide when `next` is "too far" to trust
   *  (e.g. falling back to a waypoint target) without recomputing it. */
  nextDistSq: number | null;
} {
  if (userPos === null) {
    return { next: null, newlyVisited: null, nextDistSq: null };
  }

  const nearest = nearestUnvisited(points, (i) => visited.has(i), userPos);
  if (nearest === null) {
    return { next: null, newlyVisited: null, nextDistSq: null };
  }

  const arrivalRadiusSq = arrivalRadiusM * arrivalRadiusM;
  if (nearest.distSq > arrivalRadiusSq) {
    return {
      next: nearest.index,
      newlyVisited: null,
      nextDistSq: nearest.distSq,
    };
  }

  const following = nearestUnvisited(
    points,
    (i) => visited.has(i) || i === nearest.index,
    userPos,
  );
  return {
    next: following === null ? null : following.index,
    newlyVisited: nearest.index,
    nextDistSq: following === null ? null : following.distSq,
  };
}
