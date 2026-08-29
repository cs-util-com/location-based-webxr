/**
 * True-north user-heading kernel.
 *
 * Turns the latest AR camera rotation into an absolute compass bearing (degrees
 * clockwise from geographic North) so the live/replay map overlay can draw a
 * thin view-direction line from the user-position dot. See Finding 2 of
 * gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-06-28-1822-map-rings-transparency-and-view-direction-user-feedback.md.
 *
 * Why this lives in the app-framework (NOT the library's `orientation-heading.ts`):
 * that library module is the MAGNETIC path — its bearings come from the
 * AbsoluteOrientationSensor's device→ENU quaternion and are explicitly magnetic
 * (they need WMM declination correction). Finding 2's locked source is the
 * GPS+SLAM **alignment matrix → true geographic north**, which rejects the
 * magnetic sensor. So the math belongs here, alongside `fused-path.ts`, which
 * already converts AR odometry through the same alignment matrix.
 *
 * Frame algebra (pinned by `user-heading.test.ts`):
 * - State stores odometry rotations as NUE quaternions
 *   (`webxrQuaternionToNUE(odomRotation)` in the library reducer). NUE means
 *   X=North, Y=Up, Z=East.
 * - A WebXR camera looks down its own −Z. The basis-change `webxrToNUE` maps
 *   that local forward `[0,0,-1]` to `[1,0,0]`, so the camera-forward basis
 *   vector in the NUE-AR frame is **[1, 0, 0]** (an identity camera looks North).
 * - The alignment matrix maps AR-NUE → world NUE metres (same matrix
 *   `computeFusedPath` applies to positions). Rotating the forward direction by
 *   it yields a world-NUE direction; the geographic bearing is
 *   `atan2(East, North)`.
 *
 * We rotate the *direction* and read the bearing directly rather than
 * round-tripping two points through `calcGpsCoords`: lat/lon scale North and
 * East by different metres-per-degree, so a naive GPS-coord bearing would be
 * anisotropically distorted. The aligned NUE metres already carry the true
 * bearing, so `atan2(East, North)` is both simpler and undistorted.
 */

import { vec3 } from 'gl-matrix';
import type { Matrix4, Quaternion } from 'gps-plus-slam-js';
import { normalizeBearingDeg } from './bearing-degrees.js';

/** Camera-forward basis vector in the NUE-AR frame: `webxrToNUE([0,0,-1]) = [1,0,0]`. */
const NUE_CAMERA_FORWARD: vec3 = [1, 0, 0];

/**
 * Minimum horizontal fraction of the (unit) forward direction below which the
 * heading is treated as undefined. Because `horiz/len = sin(angle from
 * vertical)`, `horiz/len < GUARD` means the camera points within
 * `asin(0.08) ≈ 4.6°` of straight up/down (equivalently, pitched more than ~85°
 * from horizontal), where a 2D map bearing is meaningless and jittery. Mirrors
 * the rationale of the library's `VERTICAL_GUARD` (0.08).
 */
const VERTICAL_GUARD = 0.08;

const RAD_TO_DEG = 180 / Math.PI;

/** Inputs to {@link computeUserHeadingDeg}. */
export interface UserHeadingInput {
  /**
   * Latest odometry rotation as a NUE quaternion `[x,y,z,w]` (exactly as stored
   * in `gpsEvents.odometryRotations`). Null/undefined before the first pose.
   */
  odometryRotation?: Quaternion | null;
  /**
   * GPS+SLAM alignment matrix (AR-NUE → world NUE metres), column-major.
   * Null/undefined before the first alignment solve.
   */
  alignmentMatrix?: Matrix4 | null;
}

const _forward = vec3.create();
const _origin = vec3.create();
const _tip = vec3.create();
const _dir = vec3.create();

/**
 * Compute the user's absolute view-direction bearing in degrees clockwise from
 * geographic North, in `[0, 360)`, or `null` when undefined.
 *
 * Returns `null` when there is no rotation yet, no alignment matrix yet, or the
 * camera points near-vertically (see {@link VERTICAL_GUARD}). Position is NOT
 * required — the bearing is a pure direction; the consumer only draws the line
 * when it also has a user-position dot to anchor it to.
 */
export function computeUserHeadingDeg(input: UserHeadingInput): number | null {
  const { odometryRotation, alignmentMatrix } = input;
  if (!odometryRotation || !alignmentMatrix) {
    return null;
  }

  // Camera forward in the AR-NUE frame. The stored quaternion is already the
  // `[x,y,z,w]` 4-tuple `transformQuat` reads (`Quaternion` satisfies
  // `ReadonlyQuat`), so it is used directly — it is only read, never mutated.
  vec3.transformQuat(_forward, NUE_CAMERA_FORWARD, odometryRotation);

  // Rotate the forward DIRECTION into world NUE via the alignment matrix.
  // Transform two points and subtract so the matrix's translation cancels,
  // leaving exactly the linear (rotation/scale) part applied to the direction.
  // The alignment matrix is already the flat column-major 16-tuple
  // `vec3.transformMat4` reads (`Matrix4` satisfies `ReadonlyMat4`), so it is
  // used directly — copying it into a fresh `Float32Array(16)` per call used to
  // dominate this 30–60 Hz frame-loop path's allocations. The transforms only
  // READ the matrix (pinned by the frozen-input test), so sharing is safe.
  vec3.set(_origin, 0, 0, 0);
  vec3.transformMat4(_origin, _origin, alignmentMatrix);
  vec3.transformMat4(_tip, _forward, alignmentMatrix);
  vec3.subtract(_dir, _tip, _origin);

  const north = _dir[0];
  const east = _dir[2];
  const len = Math.hypot(_dir[0], _dir[1], _dir[2]);
  const horiz = Math.hypot(north, east);
  // A non-finite sensor sample (NaN/Infinity in the quaternion or alignment
  // matrix) propagates through the math above into `len`/`horiz`. Guarding their
  // finiteness here rejects every such sample as "heading undefined" (null)
  // without the per-frame closure allocation that an explicit `.some()` input
  // scan would cost — `computeUserHeadingDeg` runs at 30–60 Hz. Without this,
  // `len`/`horiz` are NaN (so the magnitude guards pass) and a NaN bearing would
  // leak into `headingUpQuat`, poisoning the CSS3D quaternion.
  if (
    !Number.isFinite(len) ||
    !Number.isFinite(horiz) ||
    len < 1e-9 ||
    horiz / len < VERTICAL_GUARD
  ) {
    return null;
  }

  const deg = Math.atan2(east, north) * RAD_TO_DEG;
  return normalizeBearingDeg(deg);
}
