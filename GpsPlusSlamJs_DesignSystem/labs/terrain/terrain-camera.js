/**
 * The terrain lab's camera poses (terrain plan 2026-09-27-0605 §4 "Camera
 * presets", §9 finding 10). A pose is ALTITUDE above the datum plane, TILT
 * from straight down, and HEADING (the direction the camera looks, degrees
 * clockwise from north), orbiting a target on the plane. Altitude rather
 * than distance because the auto exaggeration reads it (W = 0.43 x
 * altitude) and the hash stores it.
 *
 * Positions are in three's frame: x east, y up, z SOUTH (north is -z),
 * metres from the target.
 *
 * @see terrain-camera.js.md
 */
import { smoothstep } from "./terrain-style.js";

const DEG = Math.PI / 180;

/**
 * The presets (plan §4): top-down at the screenshots' width (250 km, so
 * 580 km up), the diorama's oblique at 60°, a low oblique at 20 km.
 */
export const CAMERA_PRESETS = Object.freeze({
  top: Object.freeze({ altitudeM: 580_000, tiltDeg: 0, headingDeg: 0 }),
  oblique: Object.freeze({ altitudeM: 170_000, tiltDeg: 60, headingDeg: 340 }),
  low: Object.freeze({ altitudeM: 20_000, tiltDeg: 70, headingDeg: 20 }),
});

/** The scripted fly-in (plan §9 finding 10): 600 km oblique to 20 km. */
export const FLY_IN = Object.freeze({
  from: Object.freeze({ altitudeM: 600_000, tiltDeg: 45, headingDeg: 330 }),
  to: CAMERA_PRESETS.low,
  durationMs: 12_000,
});

/** The camera's offset from its target for a pose, [x, y, z] metres. */
export function orbitPosition({ altitudeM, tiltDeg, headingDeg }) {
  const back = altitudeM * Math.tan(tiltDeg * DEG);
  const h = headingDeg * DEG;
  // Looking toward the heading, so standing `back` metres the other way:
  // east -sin(h), north -cos(h); three's z is south, so +cos(h).
  return [-Math.sin(h) * back, altitudeM, Math.cos(h) * back];
}

/** The pose of a camera offset [x, y, z] from its target. */
export function poseFromPosition([x, y, z]) {
  const back = Math.hypot(x, z);
  const heading = (Math.atan2(-x, z) / DEG + 360) % 360;
  return {
    altitudeM: y,
    tiltDeg: Math.atan2(back, y) / DEG,
    headingDeg: back === 0 ? 0 : heading,
  };
}

/** The hash's resolution: `alt` in whole metres, angles in 0.01°. */
const ALT_STEP_M = 1;
const ANGLE_STEP_DEG = 0.01;

/** A pose as the hash writes it: `alt`, `tilt`, `head` at its resolution. */
export function poseHashValues({ altitudeM, tiltDeg, headingDeg }) {
  const round = (v, step) => Math.round(v / step) * step;
  return {
    alt: round(altitudeM, ALT_STEP_M),
    tilt: +round(tiltDeg, ANGLE_STEP_DEG).toFixed(2),
    head: +(round(headingDeg, ANGLE_STEP_DEG) % 360).toFixed(2),
  };
}

/** The signed difference `b - a` in degrees, the short way round. */
const angleStep = (a, b) => ((((b - a) % 360) + 540) % 360) - 180;

/**
 * When a drag's damping counts as settled (T0/T1 review finding 12): one
 * frame moves every angle by less than 0.005° and the altitude by less than
 * a 1e-4 share (what 0.005° of tilt moves it by in an oblique view). The page
 * then finishes the damping at once (the remaining geometric tail is about
 * 20 such steps, 0.1°) and writes the pose it lands on.
 */
export const SETTLE = Object.freeze({ angleDeg: 0.005, altitudeShare: 1e-4 });

/** True when one frame moved the pose from `a` to `b` by less than SETTLE. */
export function poseSettled(a, b) {
  return (
    Math.abs(b.altitudeM - a.altitudeM) < SETTLE.altitudeShare * a.altitudeM &&
    Math.abs(b.tiltDeg - a.tiltDeg) < SETTLE.angleDeg &&
    Math.abs(angleStep(a.headingDeg, b.headingDeg)) < SETTLE.angleDeg
  );
}

/** The shorter way round from `a` to `b` degrees, at `t`. */
function lerpHeading(a, b, t) {
  return (a + angleStep(a, b) * t + 360) % 360;
}

/**
 * The fly-in's pose at `t` in 0-1 (clamped), eased at both ends: altitude
 * geometric (600 km to 20 km spans 30x), tilt linear, heading the short way.
 */
export function flyInPose(t, fly = FLY_IN) {
  const s = smoothstep(0, 1, t);
  if (s >= 1) return { ...fly.to };
  return poseAlong(s, fly);
}

/** The path's pose at progress `s` in 0-1 (after the ease). */
function poseAlong(s, { from, to }) {
  return {
    altitudeM: from.altitudeM * (to.altitudeM / from.altitudeM) ** s,
    tiltDeg: from.tiltDeg + (to.tiltDeg - from.tiltDeg) * s,
    headingDeg: lerpHeading(from.headingDeg, to.headingDeg, s),
  };
}

/**
 * The fly-in's pose where it passes an altitude (globe round-5 §3.3: the
 * comparison's captures): the same path, the progress from the altitude
 * (log-even), and beyond the path's ends its end's tilt and heading at the
 * altitude asked for. RangeError for a non-positive or non-finite altitude.
 */
export function flyInPoseAtAltitude(altitudeM, fly = FLY_IN) {
  if (!(altitudeM > 0) || !Number.isFinite(altitudeM)) {
    throw new RangeError(`altitude must be positive, got ${altitudeM}`);
  }
  const { from, to } = fly;
  const s =
    Math.log(altitudeM / from.altitudeM) /
    Math.log(to.altitudeM / from.altitudeM);
  const pose = poseAlong(Math.min(1, Math.max(0, s)), fly);
  return { ...pose, altitudeM };
}

/**
 * The orbit controls' damping the lab sets (three's own default): each
 * update applies this share of the turn still to go and keeps the rest.
 */
export const ORBIT_DAMPING = 0.05;

/** The steepest tilt the lab's controls allow (their `maxPolarAngle`). */
export const MAX_TILT_DEG = 89;

/**
 * The turn a mouse drag of (dx, dy) CSS px asks the orbit controls for, in
 * degrees: 360° per canvas HEIGHT on both axes (three's rotate handler,
 * rotate speed 1). `dx` turns the heading, `dy` the tilt (down lowers it).
 * RangeError for a non-positive or non-finite height.
 */
export function dragTurnDeg(dxPx, dyPx, heightPx) {
  if (!(heightPx > 0) || !Number.isFinite(heightPx)) {
    throw new RangeError(`canvas height must be positive, got ${heightPx}`);
  }
  return {
    headingTurnDeg: (360 * dxPx) / heightPx,
    tiltTurnDeg: (360 * dyPx) / heightPx,
  };
}

/**
 * The most frames a drag's damping can take from the release to the hash
 * write (`createSettleTracker`), for a turn of at most `headingTurnDeg` and
 * `tiltTurnDeg` still to go at the release, of a drag that started at a
 * tilt of `tiltDeg`. The turns are signed as `dragTurnDeg` returns them: a
 * positive tilt turn LOWERS the tilt, so the drag runs from `tiltDeg` to
 * `tiltDeg - tiltTurnDeg`.
 *
 * The derivation. With damping f, update i after the release (i = 1, 2, …)
 * moves each axis by f (1 - f)^(i-1) of that axis' turn at the release. The
 * tracker first compares at frame 2 and settles at the first frame whose
 * step is below SETTLE on every axis:
 * - heading: below `SETTLE.angleDeg`;
 * - tilt: below `SETTLE.angleDeg` and below what moves the altitude by
 *   `SETTLE.altitudeShare`. The altitude r cos(tilt) moves by at most
 *   r sin(tilt) |step| against an altitude of at least r cos(tilt), so the
 *   share is at most tan(tilt) |step|, read at the steepest tilt of the
 *   drag's path, the larger of its two ends (capped at MAX_TILT_DEG). That
 *   is conservative when the drag flattens the view: a tilt-dominated
 *   settle may then come up to ln(tan(steep) / tan(shallow)) / -ln(1 - f)
 *   frames early.
 * For an axis with turn X and threshold T, the step falls below T at the
 * first i with i - 1 > L = ln(f X / T) / -ln(1 - f), i.e. i = floor(L) + 2
 * (i = 1 when f X < T already). The bound is the later axis, at least 2.
 *
 * It is an upper bound: an update during the drag (three runs one per
 * pointer move) or a clamp leaves less to turn, never more. It is in FRAMES
 * (updates), because that is what the damping counts; the wall time is this
 * times a frame's cost, which is the machine's, not the damping's.
 * RangeError for a damping outside (0, 1), a non-finite turn or a tilt
 * outside 0-90°.
 */
export function settleFrameBound({
  headingTurnDeg,
  tiltTurnDeg,
  tiltDeg,
  dampingFactor = ORBIT_DAMPING,
  settle = SETTLE,
}) {
  if (!(dampingFactor > 0 && dampingFactor < 1)) {
    throw new RangeError(`damping must be in (0, 1), got ${dampingFactor}`);
  }
  for (const [what, v] of [
    ["heading turn", headingTurnDeg],
    ["tilt turn", tiltTurnDeg],
  ]) {
    if (!Number.isFinite(v)) {
      throw new RangeError(`${what} must be finite, got ${v}`);
    }
  }
  if (!(tiltDeg >= 0 && tiltDeg <= 90)) {
    throw new RangeError(`tilt must be in 0-90°, got ${tiltDeg}`);
  }
  const steepest = Math.min(
    MAX_TILT_DEG,
    Math.max(tiltDeg, tiltDeg - tiltTurnDeg),
  );
  const tiltThreshold = Math.min(
    settle.angleDeg,
    settle.altitudeShare / Math.tan(steepest * DEG) / DEG,
  );
  const frameBelow = (turnDeg, threshold) => {
    const first = dampingFactor * Math.abs(turnDeg);
    if (first < threshold) return 1;
    const l = Math.log(first / threshold) / -Math.log(1 - dampingFactor);
    return Math.floor(l) + 2;
  };
  return Math.max(
    2,
    frameBelow(headingTurnDeg, settle.angleDeg),
    frameBelow(tiltTurnDeg, tiltThreshold),
  );
}

/**
 * The lab's drag settle (T0/T1 review finding 12), fed one pose per frame
 * after the controls' update: `end` (the finger lifts) arms it, `start` (a
 * new gesture) disarms it, and `frame(pose)` returns true once, on the
 * first frame that moved the pose by less than SETTLE (`poseSettled`), when
 * the page finishes the damping and writes the pose. `frames` counts the
 * frames from the release to that one (the smoke's measure of the damping,
 * bounded by `settleFrameBound`); `active` is whether it is armed.
 */
export function createSettleTracker(settled = poseSettled) {
  let active = false;
  let last = null;
  let frames = 0;
  return {
    get active() {
      return active;
    },
    get frames() {
      return frames;
    },
    start() {
      active = false;
    },
    end() {
      active = true;
      last = null;
      frames = 0;
    },
    frame(pose) {
      if (!active) return false;
      frames += 1;
      if (last !== null && settled(last, pose)) {
        active = false;
        return true;
      }
      last = pose;
      return false;
    },
  };
}
