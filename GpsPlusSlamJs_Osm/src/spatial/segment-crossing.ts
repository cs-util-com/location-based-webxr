/**
 * Segment-versus-ring crossing — the "walk around, not through" primitive.
 *
 * The navigation design reduces all of pass B to **two** primitives:
 * point-in-obstacle-with-height, and **segment-vs-obstacle**. `containsPoint`
 * is the first. This is the second, and without it nothing blocks: an obstacle
 * index that only reports what is standable lets an agent walk straight through
 * a wall, because a res-13 cell is ~8 m across and a wall is half a metre
 * thick, so the wall almost never contains a cell's centre. **Blocking has to be
 * a property of the STEP, not of the cell** — which is also exactly how the
 * design phrases it.
 *
 * Kept next to `point-in-ring.ts` and in the same coordinate convention: rings
 * are `x = lng, y = lat` degrees, and the predicate is affine-invariant, so the
 * latitude/longitude anisotropy needs no correction. A crossing in degrees is a
 * crossing in metres.
 *
 * @see segment-crossing.ts.md
 */

import type { PlanarPoint } from "./point-in-ring.js";

/** Twice the signed area of the triangle `abc`; sign gives the turn direction. */
function cross(a: PlanarPoint, b: PlanarPoint, c: PlanarPoint): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

/** Whether `p` lies on segment `ab`, given it is already known to be collinear. */
function onSegment(a: PlanarPoint, b: PlanarPoint, p: PlanarPoint): boolean {
  return (
    Math.min(a.x, b.x) <= p.x &&
    p.x <= Math.max(a.x, b.x) &&
    Math.min(a.y, b.y) <= p.y &&
    p.y <= Math.max(a.y, b.y)
  );
}

/**
 * Whether segments `a→b` and `c→d` intersect, touching included.
 *
 * **Touching counts as intersecting**, and that is the safe direction here: a
 * path that grazes the corner of a wall should be refused rather than admitted,
 * because the alternative is an agent clipping through geometry at exactly the
 * places a viewer is most likely to be looking.
 *
 * The collinear-overlap case is handled explicitly. It is not exotic — a way
 * running along a wall produces it — and the orientation test alone reports all
 * four cross products as zero, which without the range check reads as "no
 * intersection".
 */
export function segmentsIntersect(
  a: PlanarPoint,
  b: PlanarPoint,
  c: PlanarPoint,
  d: PlanarPoint,
): boolean {
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);

  // The general case: each segment straddles the other's line.
  if (straddles(d1, d2) && straddles(d3, d4)) return true;

  // Collinear or touching endpoints. Each `=== 0` says the point is ON the
  // other segment's infinite line; `onSegment` is what narrows that to the
  // segment itself — without it, two collinear-but-disjoint segments (a step
  // running parallel to a wall) would read as intersecting.
  return (
    (d1 === 0 && onSegment(c, d, a)) ||
    (d2 === 0 && onSegment(c, d, b)) ||
    (d3 === 0 && onSegment(a, b, c)) ||
    (d4 === 0 && onSegment(a, b, d))
  );
}

/** Whether two orientation signs put their points on opposite sides. */
function straddles(one: number, other: number): boolean {
  return (one > 0 && other < 0) || (one < 0 && other > 0);
}

/**
 * Whether the segment `a→b` crosses the boundary of `ring`.
 *
 * **The BOUNDARY, not the interior.** A segment lying wholly inside the ring
 * crosses nothing and returns `false` — which is correct for this predicate and
 * is why callers that care about "is this position inside solid geometry" must
 * still ask `containsPoint`. The two answer different questions and the pair is
 * what the design asks for.
 *
 * The ring is treated as closed: the last vertex joins the first, whether or not
 * the caller repeated it.
 */
export function segmentCrossesRing(
  a: PlanarPoint,
  b: PlanarPoint,
  ring: readonly PlanarPoint[],
): boolean {
  if (ring.length < 2) return false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const p = ring[j];
    const q = ring[i];
    if (p === undefined || q === undefined) continue;
    if (segmentsIntersect(a, b, p, q)) return true;
  }
  return false;
}
