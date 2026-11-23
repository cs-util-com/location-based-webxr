/**
 * AR-space correction math: the rigid step an ARCore relocalization makes,
 * the correction of every older observation epoch, and the epoch of an item
 * from its capture time.
 *
 * Pure (no three.js, no store). Every value here is DERIVED from raw
 * observations; nothing computed here may ever be dispatched or recorded.
 *
 * Frames: R is the raw WebXR frame, O the odometry NUE frame of the AR world
 * group (`O = B * R`, `B` the WebXR-to-NUE basis). A jump `D` and a
 * correction `Delta(e)` are rigid transforms in O. The reference frame is
 * "now": `Delta(current epoch)` is the identity.
 *
 * All products run in double precision. `qr-pose.ts`'s `composePose` is not
 * reused because it stores through gl-matrix's default Float32 arrays
 * (about 1e-7 relative), and a 3 m jump must survive to 1e-9.
 *
 * Sidecar: `ar-space-correction.ts.md`.
 */

import { mat4, quat, vec3 } from 'gl-matrix';
import {
  webxrQuaternionToNUE,
  webxrToNUE,
  type Matrix4,
  type Quaternion,
  type Vector3,
} from 'gps-plus-slam-js';
import type { Pose } from './qr/qr-pose';

/**
 * How `jumpTransform` treats the camera's own motion between the frame
 * before the jump and the jump frame: `'always'` extrapolates it away when
 * an earlier frame gives a rate, `'off'` never does, `'guarded'` does only
 * when the camera measurably moved between the two frames before the jump.
 */
export type CompensationMode = 'guarded' | 'always' | 'off';

/**
 * Default `'guarded'`. A walking, turning user moves the camera between the
 * last frame and the jump frame, and without the compensation that motion
 * is read as part of the jump: at 30 deg/s and a 33 ms frame, 1 deg, which
 * is 0.17 m at 10 m from the camera (sweep in `ar-space-correction.test.ts`).
 * A still camera gains nothing from it and only gets the extrapolated pose
 * noise (the ratio sweep: 0.035 m against 0.020 m at 10 m at ratio 1), so
 * the guard keeps the plain D below the motion thresholds.
 */
export const CAMERA_MOTION_COMPENSATION: CompensationMode = 'guarded';

/**
 * The longest gap `t - tLast` the compensation is used across, ms. The
 * sweeps measured up to 500 ms; past it one frame's velocity is stretched
 * over an unmeasured stall, so the plain D is used. The feed forgets its
 * last pose past the same gap, so only a hand-built or replayed observation
 * reaches this fallback; it is not refused, because refusing would lose the
 * jump.
 */
export const MAX_COMPENSATION_GAP_MS = 500;

/**
 * Motion thresholds of the guard, per measured interval `tLast - tPrev`: the
 * camera moved more than this many metres OR turned more than this many
 * degrees. PROVISIONAL: about three times the per-pose noise the ratio sweep
 * assumed for a phone (1 mm and 0.05 deg per axis, so the step between two
 * still poses is about 2.3 mm and 0.11 deg at its median), until the
 * still-phone noise floor is measured on the phone (the feed logs the step
 * of every jump). A walk at 0.3 m/s moves 10 mm per 33 ms frame and a
 * 10 deg/s head turn 0.33 deg, both above.
 */
export const COMPENSATION_MIN_STEP_M = 0.005;
export const COMPENSATION_MIN_TURN_DEG = 0.25;

/** Whether `jumpTransform` compensated a jump, and why. */
export interface CompensationVerdict {
  readonly compensated: boolean;
  readonly reason:
    | 'moving'
    | 'always'
    | 'still'
    | 'off'
    | 'no-earlier-frame'
    | 'no-rate'
    | 'gap';
  /** Camera translation between `prevPose` and `lastPose`, m; null without one. */
  readonly stepM: number | null;
  /** Camera rotation between `prevPose` and `lastPose`, deg; null without one. */
  readonly turnDeg: number | null;
}

/**
 * The raw input of one jump: the jump frame (`t`, `newPose`), the frame
 * before it (`tLast`, `lastPose`), and when known the frame before that
 * (`tPrev`, `prevPose`; both `null` when no earlier frame exists). Poses are
 * raw WebXR camera poses; times are epoch milliseconds of the XR clock.
 */
export interface RelocalizationJump {
  readonly t: number;
  readonly tLast: number;
  readonly lastPose: Pose;
  readonly tPrev: number | null;
  readonly prevPose: Pose | null;
  readonly newPose: Pose;
}

export const IDENTITY_POSE: Pose = Object.freeze({
  position: [0, 0, 0] as Vector3,
  rotation: [0, 0, 0, 1] as Quaternion,
});

const f64 = (n: number): Float64Array => new Float64Array(n);
const q4 = (q: ArrayLike<number>): Quaternion => [q[0]!, q[1]!, q[2]!, q[3]!];

function unit(q: Quaternion): Float64Array {
  return quat.normalize(f64(4), q) as Float64Array;
}

/** `a ∘ b`: first `b`, then `a`. */
export function composeRigid(a: Pose, b: Pose): Pose {
  const qa = unit(a.rotation);
  const rotation = quat.multiply(f64(4), qa, unit(b.rotation));
  const moved = vec3.transformQuat(f64(3), b.position, qa);
  return {
    position: [
      moved[0] + a.position[0],
      moved[1] + a.position[1],
      moved[2] + a.position[2],
    ],
    rotation: q4(quat.normalize(rotation, rotation)),
  };
}

/** The inverse rigid transform. */
export function invertRigid(a: Pose): Pose {
  const inv = quat.conjugate(f64(4), unit(a.rotation));
  const p = vec3.transformQuat(f64(3), a.position, inv);
  return { position: [-p[0], -p[1], -p[2]], rotation: q4(inv) };
}

/** Column-major 4x4 matrix of a rigid pose (three.js `fromArray` order). */
export function poseToMatrix4(p: Pose): Matrix4 {
  const m = mat4.fromRotationTranslation(f64(16), unit(p.rotation), p.position);
  return Array.from(m) as unknown as Matrix4;
}

/** Column-major product `a * b`. */
export function multiplyMatrix4(a: Matrix4, b: Matrix4): Matrix4 {
  return Array.from(mat4.multiply(f64(16), a, b)) as unknown as Matrix4;
}

/**
 * `q^s` for a unit quaternion, along the shortest arc. Exact for a constant
 * angular rate.
 */
function quaternionPower(q: Float64Array, s: number): Float64Array {
  // atan2, not acos: acos(w) loses half the digits near w = 1, which is
  // exactly where a one-frame rotation step lives.
  const sign = q[3]! < 0 ? -1 : 1;
  const n = Math.hypot(q[0]!, q[1]!, q[2]!);
  if (n === 0) return quat.identity(f64(4)) as Float64Array;
  const half = Math.atan2(n, sign * q[3]!) * s;
  const k = (sign * Math.sin(half)) / n;
  return Float64Array.of(q[0]! * k, q[1]! * k, q[2]! * k, Math.cos(half));
}

/**
 * The camera pose at `t`, extrapolated at constant rates from `prev` (at
 * `tPrev`) and `last` (at `tLast`): the position moves linearly, the
 * orientation turns at a constant angular rate in the frame's coordinates.
 * The model is frame-invariant (a rigid change of frame commutes with it).
 * Requires `tPrev < tLast`.
 */
function extrapolatePose(
  prev: Pose,
  tPrev: number,
  last: Pose,
  tLast: number,
  t: number
): Pose {
  const s = (t - tLast) / (tLast - tPrev);
  const qPrev = unit(prev.rotation);
  const qLast = unit(last.rotation);
  const step = quat.multiply(f64(4), qLast, quat.conjugate(f64(4), qPrev));
  const rotation = quat.multiply(
    f64(4),
    quaternionPower(quat.normalize(step, step) as Float64Array, s),
    qLast
  );
  return {
    position: [
      last.position[0] + (last.position[0] - prev.position[0]) * s,
      last.position[1] + (last.position[1] - prev.position[1]) * s,
      last.position[2] + (last.position[2] - prev.position[2]) * s,
    ],
    rotation: q4(quat.normalize(rotation, rotation)),
  };
}

/**
 * Whether `jumpTransform(jump, mode)` compensates the camera's motion, and
 * why. The reasons in order: no earlier frame, no measurable rate (`tPrev`
 * not before `tLast`), a gap past `MAX_COMPENSATION_GAP_MS`, the mode
 * `'off'`, then (guarded only) the motion thresholds.
 */
export function compensationVerdict(
  jump: RelocalizationJump,
  mode: CompensationMode = CAMERA_MOTION_COMPENSATION
): CompensationVerdict {
  if (jump.prevPose === null || jump.tPrev === null) {
    return {
      compensated: false,
      reason: 'no-earlier-frame',
      stepM: null,
      turnDeg: null,
    };
  }
  const prev = jump.prevPose;
  const last = jump.lastPose;
  const stepM = Math.hypot(
    last.position[0] - prev.position[0],
    last.position[1] - prev.position[1],
    last.position[2] - prev.position[2]
  );
  const turnDeg =
    (quat.getAngle(unit(prev.rotation), unit(last.rotation)) * 180) / Math.PI;
  const plain = (
    reason: CompensationVerdict['reason']
  ): CompensationVerdict => ({ compensated: false, reason, stepM, turnDeg });
  if (!(jump.tLast > jump.tPrev)) return plain('no-rate');
  if (jump.t - jump.tLast > MAX_COMPENSATION_GAP_MS) return plain('gap');
  if (mode === 'off') return plain('off');
  const moving =
    stepM > COMPENSATION_MIN_STEP_M || turnDeg > COMPENSATION_MIN_TURN_DEG;
  if (mode === 'guarded' && !moving) return plain('still');
  return {
    compensated: true,
    reason: moving ? 'moving' : 'always',
    stepM,
    turnDeg,
  };
}

/**
 * The jump `D` in O: a point at `x` in the old frame is at `D * x` in the
 * new one. Uncompensated `D = B * P_a * P_b^-1 * B^-1` (the camera is taken
 * not to move between the two frames); compensated, `P_b` is replaced by the
 * camera pose extrapolated to the jump frame's time. Which of the two is
 * used is `compensationVerdict(jump, mode)`.
 */
export function jumpTransform(
  jump: RelocalizationJump,
  mode: CompensationMode = CAMERA_MOTION_COMPENSATION
): Pose {
  const before =
    compensationVerdict(jump, mode).compensated &&
    jump.prevPose !== null &&
    jump.tPrev !== null
      ? extrapolatePose(
          jump.prevPose,
          jump.tPrev,
          jump.lastPose,
          jump.tLast,
          jump.t
        )
      : jump.lastPose;
  const inR = composeRigid(jump.newPose, invertRigid(before));
  return {
    position: webxrToNUE(inR.position),
    rotation: webxrQuaternionToNUE(inR.rotation),
  };
}

/**
 * `Delta(e)` for every epoch `0..n` of `n` jumps (in observation order):
 * the product of every jump `j >= e`, the most recent on the left.
 * `Delta(n)` is the identity.
 */
export function correctionTrack(jumps: readonly Pose[]): readonly Pose[] {
  const track: Pose[] = new Array<Pose>(jumps.length + 1);
  track[jumps.length] = IDENTITY_POSE;
  for (let e = jumps.length - 1; e >= 0; e--) {
    track[e] = composeRigid(track[e + 1]!, jumps[e]!);
  }
  return track;
}

/**
 * The epoch of an item captured at `capturedAt`: the number of observation
 * times `<= capturedAt` (an item at exactly a jump's time belongs to the new
 * segment). `times` must be non-decreasing, as the slice guarantees.
 * Throws a `TypeError` for a non-number or NaN capture time.
 */
export function epochAt(times: readonly number[], capturedAt: number): number {
  if (typeof capturedAt !== 'number' || Number.isNaN(capturedAt)) {
    throw new TypeError('epochAt: capturedAt must be a number');
  }
  let lo = 0;
  let hi = times.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (times[mid]! <= capturedAt) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * The shown local matrix of an object: `P^-1 * Delta * P * X_raw`, where
 * `P` maps the object's parent into O and `X_raw` is its raw local matrix.
 * Recomputed from `X_raw` every time, never from a shown matrix.
 */
export function shownLocalMatrix(
  delta: Pose,
  parentToGroup: Matrix4,
  xRaw: Matrix4
): Matrix4 {
  const pInv = mat4.invert(f64(16), parentToGroup);
  if (pInv === null) {
    throw new RangeError('shownLocalMatrix: parentToGroup is not invertible');
  }
  const m = mat4.multiply(f64(16), pInv, poseToMatrix4(delta));
  mat4.multiply(m, m, parentToGroup);
  mat4.multiply(m, m, xRaw);
  return Array.from(m) as unknown as Matrix4;
}
