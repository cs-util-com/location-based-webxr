/**
 * The globe's camera (globe plan 2026-09-26-0539 §7.6): an orbit pose that
 * puts a target at the exact centre of the frame with north up, the
 * distance that fits the whole disc on screen, and the turn from one pose
 * to another. Pure: ECEF in, ECEF out, no scene.
 *
 * @see globe-camera.ts.md
 */
import * as THREE from "three";
import type { Ellipsoid } from "3d-tiles-renderer";

import type { LatLng } from "./globe-target.js";

/**
 * Where the camera looks from, as unit ECEF vectors: `direction` from the
 * Earth's centre towards the camera, `up` the screen's up, perpendicular to
 * it. The distance is separate: it follows the viewport, the pose does not.
 */
export interface OrbitPose {
  readonly direction: THREE.Vector3;
  readonly up: THREE.Vector3;
}

const DEG = Math.PI / 180;

/**
 * The pose that centres `target`, north up.
 *
 * The camera sits on the ray from the centre through the target's SURFACE
 * point (geocentric, not along the geodetic normal): that ray meets the
 * surface only there, so the target lands exactly at the centre. Up is the
 * geodetic north at the target, written out so it stays defined at a pole
 * (it points along the target's own meridian there), then made
 * perpendicular to the view.
 */
export function orbitPose(ellipsoid: Ellipsoid, target: LatLng): OrbitPose {
  const lat = target.lat * DEG;
  const lng = target.lng * DEG;
  const direction = ellipsoid
    .getCartographicToPosition(lat, lng, 0, new THREE.Vector3())
    .normalize();
  const north = new THREE.Vector3(
    -Math.sin(lat) * Math.cos(lng),
    -Math.sin(lat) * Math.sin(lng),
    Math.cos(lat),
  );
  const up = north
    .addScaledVector(direction, -north.dot(direction))
    .normalize();
  return { direction, up };
}

/** Places `camera` at `distance` along the pose, looking at the centre. */
export function applyOrbitPose(
  camera: THREE.Camera,
  pose: OrbitPose,
  distance: number,
): void {
  camera.position.copy(pose.direction).multiplyScalar(distance);
  camera.up.copy(pose.up);
  camera.lookAt(0, 0, 0);
}

/**
 * The distance from the centre at which a sphere of `radius` fills
 * `1 - margin` of the narrower half of the frame. Pass the ellipsoid's
 * largest radius and the whole Earth fits. RangeError for a field of view
 * outside (0, 180°), a non-positive aspect or radius, or a margin outside
 * [0, 1).
 */
export function orbitDistanceToFit(input: {
  fovYRad: number;
  aspect: number;
  margin: number;
  radius: number;
}): number {
  const { fovYRad, aspect, margin, radius } = input;
  if (!(fovYRad > 0 && fovYRad < Math.PI)) {
    throw new RangeError(`fovYRad must be in (0, PI), got ${fovYRad}`);
  }
  if (!(aspect > 0 && Number.isFinite(aspect))) {
    throw new RangeError(`aspect must be finite and > 0, got ${aspect}`);
  }
  if (!(margin >= 0 && margin < 1)) {
    throw new RangeError(`margin must be in [0, 1), got ${margin}`);
  }
  if (!(radius > 0 && Number.isFinite(radius))) {
    throw new RangeError(`radius must be finite and > 0, got ${radius}`);
  }
  const tanHalf = Math.tan(fovYRad / 2) * Math.min(1, aspect);
  // The disc's angular radius alpha, from tan(alpha) = (1 - margin) tan(half).
  const tanAlpha = (1 - margin) * tanHalf;
  return (radius * Math.hypot(1, tanAlpha)) / tanAlpha;
}

/**
 * The clip planes while the intro drives the camera (round-2 plan
 * 2026-09-26-2055 M3b): the near plane a fraction of the height above the
 * ground, the far plane just past the horizon.
 */
export const GLOBE_CLIP = {
  /**
   * The near plane as a fraction of the height above the ellipsoid. Every
   * surface point is at least that height away, and a point seen at angle
   * θ off the view axis has depth distance x cos θ, so the ground is never
   * clipped in a view whose half-diagonal is within acos(0.3) = 72.5°:
   * fovY 80° on a 2.5:1 screen is 66°.
   */
  nearFraction: 0.3,
  /** A floor for the near plane, metres. */
  minNearM: 1,
} as const;

/**
 * The near and far planes for a camera at `position` (the ellipsoid's
 * frame, metres), whatever it looks at:
 * - near: `GLOBE_CLIP.nearFraction` of the height above the ellipsoid
 *   (the shortest distance to it), at least `minNearM`;
 * - far: the distance to the horizon of a sphere of the POLAR radius,
 *   plus the difference of the radii. Nothing beyond the horizon is
 *   visible, and past the far plane the tiles renderer culls the far side
 *   of the Earth too, which it would otherwise load (globe plan §15).
 *
 * Over a drawn relief (F2 plan F2a, M4) `groundM` is the highest drawn
 * ground below and around the camera (m above the ellipsoid): the near
 * plane is then its fraction of the height above THAT ground. `peakM` is
 * the highest drawn peak anywhere: the far plane adds that peak's own
 * horizon distance, so a peak standing just beyond the sea-level horizon is
 * still drawn. Both default to 0, the plain ellipsoid.
 *
 * RangeError for a non-finite position or one at the centre, or a
 * non-finite ground or a negative or non-finite peak.
 */
export function clipPlanes(
  ellipsoid: Ellipsoid,
  position: THREE.Vector3,
  relief: { groundM?: number; peakM?: number } = {},
): { near: number; far: number } {
  const { groundM = 0, peakM = 0 } = relief;
  if (!Number.isFinite(groundM) || !(peakM >= 0 && Number.isFinite(peakM))) {
    throw new RangeError(
      `the drawn ground must be finite and the peak finite and >= 0, got ${groundM}, ${peakM}`,
    );
  }
  const distance = position.length();
  if (!(distance > 0 && Number.isFinite(distance))) {
    throw new RangeError(
      `camera position must be finite and off the centre, got ${position.toArray().join(", ")}`,
    );
  }
  const height = Math.max(
    0,
    ellipsoid.getPositionElevation(position) - Math.max(0, groundM),
  );
  const near = Math.max(GLOBE_CLIP.minNearM, height * GLOBE_CLIP.nearFraction);
  const radii = [ellipsoid.radius.x, ellipsoid.radius.y, ellipsoid.radius.z];
  const a = Math.max(...radii);
  const b = Math.min(...radii);
  const far =
    Math.sqrt(Math.max(0, distance ** 2 - b ** 2)) +
    Math.sqrt((b + peakM) ** 2 - b ** 2) +
    (a - b);
  return { near, far: Math.max(far, near * 2) };
}

/** Hermite ease on [0, 1], clamped outside it (`globe-ease.ts`). */
export { smoothstep } from "./globe-ease.js";

/** Below this, two directions count as parallel (same or opposite). */
const PARALLEL = 1e-9;

/** A signed angle from `a` to `b` about the unit `axis`. */
function signedAngle(
  a: THREE.Vector3,
  b: THREE.Vector3,
  axis: THREE.Vector3,
): number {
  return Math.atan2(axis.dot(new THREE.Vector3().crossVectors(a, b)), a.dot(b));
}

/**
 * The pose a fraction `t` of the way from `from` to `to` (pass an eased
 * `t`; outside [0, 1] it holds the ends).
 *
 * - The direction follows the shorter great circle. Between antipodes it
 *   turns towards `from.up`, which for a north-up pose is via north.
 * - The up is carried along the arc (so it never spins over a pole, where
 *   north-up would turn half a turn at once), and the roll left over at the
 *   end, from the carried up to `to.up`, is taken in step with `t`.
 */
export function turnPose(from: OrbitPose, to: OrbitPose, t: number): OrbitPose {
  if (t <= 0) return { direction: from.direction.clone(), up: from.up.clone() };
  if (t >= 1) return { direction: to.direction.clone(), up: to.up.clone() };
  const cross = new THREE.Vector3().crossVectors(from.direction, to.direction);
  const sin = cross.length();
  const cos = from.direction.dot(to.direction);
  let axis: THREE.Vector3 | null = null;
  let total = 0;
  if (sin >= PARALLEL) {
    axis = cross.divideScalar(sin);
    total = Math.atan2(sin, cos);
  } else if (cos < 0) {
    axis = new THREE.Vector3().crossVectors(from.direction, from.up);
    total = Math.PI;
  }
  const direction = from.direction.clone();
  const carried = from.up.clone();
  const carriedEnd = from.up.clone();
  if (axis) {
    direction.applyAxisAngle(axis, total * t);
    carried.applyAxisAngle(axis, total * t);
    carriedEnd.applyAxisAngle(axis, total);
  }
  const roll = signedAngle(carriedEnd, to.up, to.direction);
  const up = carried.applyAxisAngle(direction, roll * t);
  return { direction, up };
}
