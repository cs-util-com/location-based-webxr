/**
 * The frame math behind the authoring settle (authoring plan 2026-09-28-0953
 * §3.2, M2c; decisions D2 and D10b): where an authored object sits in the
 * AR world group's own frame, how that becomes GPS-world, and how a later
 * visit is corrected through the printed code.
 *
 * THREE FRAMES, and every function here names which one it takes:
 * - RAW WebXR odometry (X = East, Y = Up, Z = South): the camera's pose, a
 *   photo's capture pose, the code's fused pose.
 * - ODOMETRY-NUE (X = North, Y = Up, Z = East): the local frame of
 *   `arWorldGroup`, i.e. the DOMAIN of the store's alignment matrix. The
 *   hit-test reticle lives here, and so do the rigid authoring previews.
 * - GPS-WORLD NUE: the scene root; `alignment · odometry-NUE`. Geo is
 *   minted from here (`mintQrGeoPose`).
 *
 * The raw-to-odometry-NUE step is ONE function, {@link odomNueFromWebXr},
 * because `content-placement.ts` records a 90-degree yaw bug from exactly
 * this mix-up: the basis factor LEADS (`WEBXR_TO_NUE · pose`), which is what
 * the scene graph's `basisChangeNode` does and what the framework's mint
 * composition (`qrWorldPoseFromOdom`) does. The trailing form is for replayed
 * state only.
 *
 * @see visit-anchoring.ts.md
 */

import { WEBXR_TO_NUE } from "gps-plus-slam-app-framework/ar/webxr-nue-basis";
import type { Pose } from "gps-plus-slam-app-framework/ar/qr/qr-pose";
import { Matrix4, Quaternion, Vector3 } from "three";

/** A pose in one of the two NUE frames (the function says which). */
export interface NuePose {
  readonly position: readonly [number, number, number];
  readonly rotation: readonly [number, number, number, number];
}

function poseMatrix(pose: {
  readonly position: readonly [number, number, number];
  readonly rotation: readonly [number, number, number, number];
}): Matrix4 {
  return new Matrix4().compose(
    new Vector3(...pose.position),
    new Quaternion(...pose.rotation),
    new Vector3(1, 1, 1),
  );
}

function decomposed(m: Matrix4): NuePose {
  const position = new Vector3();
  const rotation = new Quaternion();
  m.decompose(position, rotation, new Vector3());
  rotation.normalize();
  return {
    position: [position.x, position.y, position.z],
    rotation: [rotation.x, rotation.y, rotation.z, rotation.w],
  };
}

/**
 * A RAW WebXR odometry pose in the world group's frame (odometry-NUE):
 * `WEBXR_TO_NUE · pose`, the basis factor leading.
 *
 * This is where a photo's capture pose and the code's fused pose are kept
 * for the settle; a pin's reticle is already in this frame.
 */
export function odomNueFromWebXr(pose: Pose): NuePose {
  return decomposed(
    new Matrix4().copy(WEBXR_TO_NUE).multiply(poseMatrix(pose)),
  );
}

/** The 16 column-major numbers of an alignment, or null when they are not
 *  16 finite numbers (the store's value is external data here). */
function readMatrix(alignment: ArrayLike<number>): Matrix4 | null {
  if (alignment.length !== 16) return null;
  const values = Array.from(alignment);
  if (!values.every((v) => typeof v === "number" && Number.isFinite(v))) {
    return null;
  }
  return new Matrix4().fromArray(values);
}

/**
 * An odometry-NUE pose through an alignment into GPS-world NUE:
 * `alignment · local`.
 *
 * @returns null when the alignment is not 16 finite numbers.
 */
export function throughAlignment(
  local: NuePose,
  alignment: ArrayLike<number>,
): NuePose | null {
  const a = readMatrix(alignment);
  if (a === null) return null;
  return decomposed(a.multiply(poseMatrix(local)));
}

function finitePose(pose: NuePose): boolean {
  return (
    pose.position.length === 3 &&
    pose.rotation.length === 4 &&
    [...pose.position, ...pose.rotation].every(Number.isFinite) &&
    Math.hypot(...pose.rotation) > 1e-9
  );
}

/**
 * The code correction (D10b): the rigid move, in GPS-world NUE, that puts
 * THIS visit's code measurement onto the code's stored pose.
 *
 * YAW AND TRANSLATION ONLY. Both frames share gravity, so Up is never
 * turned: the difference in the two measurements' tilt is pose-solve noise
 * of a few degrees, and applying it would tilt the whole visit - at a note
 * 20 m away, a metre of height. The yaw is the twist about Up of
 * `stored · measured⁻¹`, which is exactly the yaw the two poses differ by
 * and, like the solver's own alignment, turns only about Up.
 *
 *     T(p) = R_yaw · (p - measured.position) + stored.position
 *
 * so `T(measured.position) = stored.position` exactly.
 *
 * @returns column-major 4x4 numbers, or null for non-finite input and for
 *   the one pose pair with no defined yaw (the two differ by a half turn
 *   about a horizontal axis - a code seen upside down, not a re-sighting).
 */
export function codeCorrection(
  measured: NuePose,
  stored: NuePose,
): number[] | null {
  if (!finitePose(measured) || !finitePose(stored)) return null;
  const delta = new Quaternion(...stored.rotation)
    .normalize()
    .multiply(new Quaternion(...measured.rotation).normalize().invert());
  const twistNorm = Math.hypot(delta.y, delta.w);
  if (twistNorm < 1e-9) return null;
  const yaw = new Quaternion(0, delta.y / twistNorm, 0, delta.w / twistNorm);
  const t = new Matrix4().makeRotationFromQuaternion(yaw);
  const turned = new Vector3(...measured.position).applyMatrix4(t);
  t.setPosition(new Vector3(...stored.position).sub(turned));
  return t.toArray();
}

/**
 * The visit's alignment corrected through the code: `T · alignment`, where
 * `T` is the {@link codeCorrection} of the code as this visit measured it
 * (`alignment · codeOdomNue`) onto its stored pose.
 *
 * An object of the visit settled through this sits where the measuring
 * visit's alignment would have put it relative to the code. For a yaw-only
 * alignment (the only kind the solver produces) the result does not depend
 * on `alignment` at all - which is why earlier visits' objects re-shown
 * through it stay rigid while GPS re-solves (see the property tests).
 *
 * @param alignment the visit's alignment (odometry-NUE -> GPS-world NUE)
 * @param codeOdomNue the code's pose in THIS visit, odometry-NUE
 * @param storedCode the code's stored pose, GPS-world NUE
 * @returns null when the alignment cannot be read or no correction exists
 */
export function correctedAlignment(
  alignment: ArrayLike<number>,
  codeOdomNue: NuePose,
  storedCode: NuePose,
): number[] | null {
  const a = readMatrix(alignment);
  const measured = throughAlignment(codeOdomNue, alignment);
  if (a === null || measured === null) return null;
  const t = codeCorrection(measured, storedCode);
  if (t === null) return null;
  return new Matrix4().fromArray(t).multiply(a).toArray();
}
