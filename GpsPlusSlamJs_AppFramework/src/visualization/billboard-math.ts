/**
 * Pure cylindrical-billboard math.
 *
 * A `THREE.Sprite` always fully faces the camera (it tilts and rolls with it).
 * For an upright AR marker we instead use a textured plane and yaw it ourselves
 * around the world Y axis only — a "cylindrical" billboard that turns to face
 * the user horizontally but never pitches or rolls.
 *
 * This module owns the single decision in that behaviour — the Y rotation — and
 * nothing else, so it can be unit-tested with no WebGL/DOM. The view layer
 * applies the result as `mesh.rotation.set(0, yaw, 0)`, which is what
 * guarantees pitch/roll stay exactly 0 (they are never written).
 *
 * Convention: the plane's **+Z** local axis is its front (image) face — the
 * side the texture is seen from. `PlaneGeometry`'s front face has normal +Z, so
 * yawing +Z toward the camera shows the image to the user.
 *
 * Lives in `components/shared/` because it is reused verbatim by the billboard
 * (component 1) and in-world-text (component 2) demos, and is an upstream-PR
 * candidate (GPS-free, dependency-free).
 */

/** A horizontal position; only the X/Z plane matters for yaw. */
export interface HorizontalPoint {
  readonly x: number;
  readonly z: number;
}

/**
 * Y rotation (radians) that turns a +Z-facing plane at `billboard` to face
 * `camera` in the XZ plane. Camera height (Y) is irrelevant by design.
 *
 * Returns `fallback` when the camera is directly above/below the billboard
 * (no horizontal direction exists), so the marker holds its last orientation
 * instead of snapping.
 */
export function computeBillboardYaw(
  billboard: HorizontalPoint,
  camera: HorizontalPoint,
  fallback = 0
): number {
  const dx = camera.x - billboard.x;
  const dz = camera.z - billboard.z;
  if (dx === 0 && dz === 0) {
    return fallback;
  }
  // atan2(dx, dz) is the angle of the camera direction measured from +Z toward
  // +X — exactly the yaw that rotates local +Z onto (dx, _, dz).
  return Math.atan2(dx, dz);
}
