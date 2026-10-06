/**
 * Move an object with its code (UI round 1, U3; owner decision 2026-10-06):
 * when a code's saved position is IMPROVED (the same poster, measured
 * better), the pins and photos within about 40 m keep exactly their place
 * relative to it - a rigid transform from the old code pose to the new
 * one. A real move of the poster does NOT use this (D19: a pin about a
 * nearby landmark stays at the landmark). Pure.
 *
 * @see move-with-code.ts.md
 */

import { Quaternion, Vector3 } from "three";
import {
  calcGpsCoords,
  calcRelativeCoordsInMeters,
} from "gps-plus-slam-app-framework/core";
import type { QrGeoPose } from "gps-plus-slam-app-framework/ar/qr/qr-gps-vote";

import { CODE_EVENT_REACH_M } from "./visit-settle.js";

const UP = new Vector3(0, 1, 0);
const DEG = Math.PI / 180;

/** A pose's orientation in the NUE frame: its rotation, or a heading `h`
 *  as the rotation of -h about Up (the QR geo-pose convention). */
function orientation(pose: QrGeoPose): Quaternion {
  if (pose.rotation !== undefined) {
    const [x, y, z, w] = pose.rotation;
    return new Quaternion(x, y, z, w);
  }
  return new Quaternion().setFromAxisAngle(UP, -(pose.headingDeg ?? 0) * DEG);
}

/** The heading a rotation about Up implies, in [0, 360). */
function headingOf(q: Quaternion): number {
  const forward = new Vector3(1, 0, 0).applyQuaternion(q); // North, rotated
  const deg = Math.atan2(forward.z, forward.x) / DEG; // from North towards East
  return ((deg % 360) + 360) % 360;
}

/**
 * The object's pose after its code moved from `oldCode` to `newCode`,
 * keeping its offset and turn relative to the code. Rotations stay
 * rotations; a heading-only object gets its heading turned by the code's
 * turn about Up.
 */
export function moveWithCode(
  object: QrGeoPose,
  oldCode: QrGeoPose,
  newCode: QrGeoPose,
): QrGeoPose {
  const qOld = orientation(oldCode);
  const qNew = orientation(newCode);
  const turn = qNew.clone().multiply(qOld.clone().invert());
  const r = calcRelativeCoordsInMeters(
    oldCode,
    object,
    object.alt,
    oldCode.alt,
  );
  const offset = new Vector3(r[0], r[1], r[2]).applyQuaternion(turn);
  const { lat, lon } = calcGpsCoords(newCode, [offset.x, offset.y, offset.z]);
  const moved = { lat, lon, alt: newCode.alt + offset.y };
  if (object.rotation !== undefined) {
    const q = turn.clone().multiply(orientation(object)).normalize();
    return { ...moved, rotation: [q.x, q.y, q.z, q.w] };
  }
  return {
    ...moved,
    headingDeg: headingOf(turn.clone().multiply(orientation(object))),
  };
}

/** The objects an improved code takes with it: within about 40 m (the
 *  reach D33 ties notes to a code event with). */
export function withinCodeReach(object: QrGeoPose, code: QrGeoPose): boolean {
  const r = calcRelativeCoordsInMeters(code, object);
  return Math.hypot(r[0], r[2]) <= CODE_EVENT_REACH_M;
}
