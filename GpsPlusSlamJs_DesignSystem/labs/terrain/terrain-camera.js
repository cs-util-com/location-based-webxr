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
