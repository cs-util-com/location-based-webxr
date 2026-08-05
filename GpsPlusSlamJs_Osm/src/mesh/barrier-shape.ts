/**
 * Barrier footprints — turning an open way into rings with area.
 *
 * A barrier is a LINE in OSM, and everything downstream needs a polygon:
 * `extrudeBuilding` takes closed rings, and pass B's point-in-obstacle test
 * needs something that contains the wall. The `width` tag (or
 * `DEFAULT_BARRIER_THICKNESS_M`) is what gives the line an extent.
 *
 * **One quad per segment, not one buffered outline.** Offsetting a polyline as
 * a single outline needs a join rule at every vertex, and the usual one —
 * mitre — sends the join point towards infinity as the turn approaches 180
 * degrees. A hairpin in a fence would then obstruct ground nobody walled off
 * and draw a spike across the scene. Per-segment quads cannot do that: every
 * vertex is within half a thickness of its own segment, so the footprint stays
 * within half a thickness of the line no matter what the way does.
 *
 * The cost is overlapping quads at each joint, which is invisible for opaque
 * walls and harmless for a point-in-polygon test that asks "any of them".
 *
 * @see barrier-shape.ts.md
 */

import type { EnuPoint } from "./enu.js";

/**
 * Signed shoelace area of a ring, in square metres.
 *
 * Positive is counter-clockwise. Exported because the barrier tests assert
 * against it, and a helper reimplemented inside a test could agree with itself
 * while disagreeing with the geometry it is checking.
 */
export function ringArea(ring: readonly EnuPoint[]): number {
  if (ring.length < 3) return 0;
  let twice = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    twice += a.x * b.y - b.x * a.y;
  }
  return twice / 2;
}

/**
 * One rectangle per segment of `line`, each `thicknessM` wide and centred on
 * the segment.
 *
 * **Centred, because the way IS the wall's centreline in OSM.** A footprint
 * offset to one side would put the obstacle beside the wall the viewer sees.
 *
 * Zero-length segments are skipped rather than normalised: a segment with no
 * direction has no normal, and dividing by its length yields `NaN` vertices —
 * which propagate into the mesh, where three.js draws nothing and reports no
 * error. Duplicated consecutive nodes are ordinary in OSM, so this is a live
 * path.
 *
 * @throws `RangeError` if the thickness is not finite and positive. A
 *   zero-width footprint has no area, so triangulation yields nothing and the
 *   barrier silently fails to exist.
 */
export function barrierFootprints(
  line: readonly EnuPoint[],
  thicknessM: number,
): EnuPoint[][] {
  if (!Number.isFinite(thicknessM) || thicknessM <= 0) {
    throw new RangeError(
      `barrierFootprints: thickness must be a finite positive number of metres, got ${thicknessM}`,
    );
  }

  const half = thicknessM / 2;
  const rings: EnuPoint[][] = [];

  for (let i = 0; i + 1 < line.length; i++) {
    const a = line[i]!;
    const b = line[i + 1]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy);
    if (length === 0) continue;

    // The left-hand normal, scaled to half the thickness.
    const nx = (-dy / length) * half;
    const ny = (dx / length) * half;

    // WOUND CONSISTENTLY, which `triangulate` depends on: the sign of a ring's
    // area is its orientation, and quads disagreeing with each other would
    // extrude with their faces pointing opposite ways — a wall lit from the
    // inside. This order is counter-clockwise for every segment because it is
    // expressed in the segment's own frame rather than in world axes.
    rings.push([
      { x: a.x - nx, y: a.y - ny },
      { x: b.x - nx, y: b.y - ny },
      { x: b.x + nx, y: b.y + ny },
      { x: a.x + nx, y: a.y + ny },
    ]);
  }

  return rings;
}
