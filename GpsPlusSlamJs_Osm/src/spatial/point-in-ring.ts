/**
 * Ray-casting point-in-ring.
 *
 * Extracted from `mesh/buildings.ts`, where it was private, because the
 * navigation obstacle test needs exactly the same predicate and a second copy
 * would be a second set of edge cases to keep in agreement.
 *
 * **Generic over `{ x, y }` on purpose.** `buildings.ts` asks in ENU metres and
 * the obstacle index asks in lat/lng, and ray casting gives the same answer for
 * both: crossing parity is invariant under any affine transform, and lat/lng to
 * local ENU is affine at the scale of a building. So the anisotropy between a
 * degree of latitude and a degree of longitude does not have to be corrected
 * for — which is worth knowing, because correcting for it is the obvious
 * instinct and it would be wasted work.
 *
 * @see point-in-ring.ts.md
 */

/** Anything with planar coordinates: ENU metres, or lng/lat as x/y. */
export interface PlanarPoint {
  readonly x: number;
  readonly y: number;
}

/**
 * Whether `point` lies inside `ring`, by crossing parity.
 *
 * The ring is treated as closed — the last vertex joins the first — and its
 * winding does not matter.
 *
 * **Boundary cases are not defined**, and deliberately not asserted anywhere: a
 * point exactly on an edge lands on whichever side the floating-point
 * comparison falls, and no caller here has a stake in which. An agent standing
 * precisely on a wall's face is not a case the navigation model needs to
 * adjudicate; a state a millimetre either way is.
 */
export function containsPoint(
  ring: readonly PlanarPoint[],
  point: PlanarPoint,
): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (a === undefined || b === undefined) continue;
    const straddles = a.y > point.y !== b.y > point.y;
    if (!straddles) continue;
    const x = ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
    if (point.x < x) inside = !inside;
  }
  return inside;
}
