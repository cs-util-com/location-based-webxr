/**
 * Heading-up minimap rotation helper.
 *
 * The live in-AR minimap is a Leaflet map wrapped in a three.js `CSS3DObject`
 * lying flat below the camera. Its baseline orientation is a single −π/2
 * rotation about the local +X axis (`tilt`), which lays the DOM plane flat so
 * the user looks down on a NORTH-UP map (its plane normal points world +Y).
 *
 * "Heading-up" mode spins that flat map in its own plane so the user's view
 * direction always points up/forward. We do this by composing a yaw about the
 * world up axis (+Y) with the baseline tilt:
 *
 *     quaternion = yaw(−headingDeg about +Y) · tilt(−π/2 about +X)
 *
 * Because the yaw is about +Y and the tilted plane's normal is already +Y, the
 * normal is invariant under the yaw — the map stays flat and merely rotates
 * in-plane. The map's parent (`CameraFollower`) is rotation-identity, so the
 * object-local axes equal world axes; the yaw is therefore about true world up.
 *
 * Sign: the *magnitude* and *axis* of the rotation are pinned by
 * `heading-up-rotation.test.ts`; the *perceived* turn direction was
 * device-verified correct with `YAW_SIGN = -1` (2026-06-29, see
 * gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-06-29-0752-heading-up-minimap-rotation-plan.md).
 * `YAW_SIGN` remains the one place to flip if a future frame/convention change
 * ever inverts it.
 */

import { quat } from 'gl-matrix';
import { normalizeBearingDeg } from '../utils/bearing-degrees.js';

/** Baseline tilt: −π/2 about +X (lays the map flat, normal → world +Y). */
const TILT_X_RAD = -Math.PI / 2;

/**
 * Sign of the yaw applied for a positive (clockwise-from-north) heading.
 * Isolated as the single knob the on-device sign check would flip.
 */
const YAW_SIGN = -1;

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

// Baseline tilt quaternion, computed once (no per-call allocation churn).
const TILT = quat.setAxisAngle(quat.create(), [1, 0, 0], TILT_X_RAD);

/** World-up yaw axis, hoisted so the per-frame call allocates nothing
 *  (`setAxisAngle` only reads it). */
const UP_AXIS: readonly [number, number, number] = [0, 1, 0];

const _yaw = quat.create();
const _out = quat.create();

/**
 * Quaternion (`[x, y, z, w]`) for the `CSS3DObject`: the baseline −π/2 tilt plus
 * an in-plane yaw of `azimuthDeg` about world-up.
 *
 * `azimuthDeg` is the yaw to apply, NOT a heading: the consumer passes
 * `viewAzimuth(camera) − userHeading` (camera-relative — see the file header and
 * `viewAzimuthDeg`). `azimuthDeg = 0` returns the baseline tilt-only orientation
 * (north-up); the map's north edge ends up pointing along scene azimuth
 * `azimuthDeg` (atan2(x, −z) convention).
 *
 * @param azimuthDeg In-plane yaw to apply, degrees, atan2(x, −z) convention.
 * @returns A unit quaternion as a 4-tuple `[x, y, z, w]`.
 */
export function headingUpQuat(
  azimuthDeg: number
): [number, number, number, number] {
  quat.setAxisAngle(_yaw, UP_AXIS, YAW_SIGN * azimuthDeg * DEG_TO_RAD);
  // Apply tilt first, then yaw: q = yaw · tilt.
  quat.multiply(_out, _yaw, TILT);
  return [_out[0], _out[1], _out[2], _out[3]];
}

/**
 * Azimuth (degrees clockwise, `[0, 360)`) that the camera is looking, measured
 * in the same scene frame and convention as {@link headingUpQuat}'s input
 * (0° = looking along world −Z, +90° = looking along world +X).
 *
 * Why this is needed for heading-up: the minimap is world-locked (its parent is
 * rotation-identity) but it is composited through the **live head-tracked
 * camera**, so the camera already rotates the map's on-screen appearance as the
 * user turns. The map's local heading-up yaw must therefore be expressed
 * RELATIVE to the camera, not in absolute GPS-north terms — otherwise the
 * camera's rotation is double-counted and the result is only correct at a single
 * heading (the difference being the GPS↔scene alignment yaw). The consumer rolls
 * the alignment offset out by feeding `headingUpQuat(viewAzimuth − userHeading)`.
 *
 * @param matrixWorldElements The camera's `matrixWorld.elements` (column-major).
 *   The camera looks down its local −Z, so world-forward = −(3rd column).
 * @returns The camera's horizontal viewing azimuth in `[0, 360)` degrees.
 */
export function viewAzimuthDeg(matrixWorldElements: ArrayLike<number>): number {
  // world-forward = −(local +Z column) = (−m[8], −m[9], −m[10]); azimuth uses the
  // horizontal components in the atan2(x, −z) convention (0 at −Z, +90 at +X).
  // `?? 0` satisfies noUncheckedIndexedAccess (a real Matrix4 always has 16).
  const m8 = matrixWorldElements[8] ?? 0;
  const m10 = matrixWorldElements[10] ?? 0;
  const deg = Math.atan2(-m8, m10) * RAD_TO_DEG;
  return normalizeBearingDeg(deg);
}
