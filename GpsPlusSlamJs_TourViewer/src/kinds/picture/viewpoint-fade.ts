/**
 * How much of a viewpoint picture shows, by where the visitor stands and
 * which way they look. Every picture that appears at its spot (then and
 * now, sharpen, the viewer, the finder's fill) shows on one plane on the
 * viewpoint's axis, and its opacity is proximity times facing: a distance
 * ramp (far to near, metres from the spot, measured on the ground) times a
 * facing gate (out to in, degrees between the visitor's heading and the
 * viewpoint's). Only the numbers differ per view.
 *
 * @see viewpoint-fade.ts.md
 */
import type { TourPictureViewpoint } from "gps-plus-slam-app-framework/ar/tour-kinds";
import { Quaternion, Vector3 } from "three";
import { smoothstep } from "../../smoothstep.js";

/** A distance ramp and a facing gate. `ramp`: from `far` (nothing shows)
 *  to `near` (all of it), metres from the spot; `gate`: from `out`
 *  (nothing) to `in` (all), degrees off the viewpoint's heading. */
export interface ViewpointFade {
  readonly ramp: readonly [far: number, near: number];
  readonly gate: readonly [out: number, inside: number];
}

/** Then and now: within 2.6 m of the spot, fully from 0.9 m; facing within
 *  50 degrees, fully within 30. */
export const THEN_NOW_FADE: ViewpointFade = {
  ramp: [2.6, 0.9],
  gate: [50, 30],
};
/** The viewer: the picture takes over over the last 3 m. */
export const VIEWER_FADE: ViewpointFade = { ramp: [3, 0.8], gate: [50, 25] };
/** Sharpen, a plain fade-in from 7 m and within 70 degrees: the default of
 *  a swept grid of three ramps by three gates. */
export const SHARPEN_FADE: ViewpointFade = { ramp: [7, 0.5], gate: [70, 15] };
/** The finder's fill: only once the corners nearly meet. */
export const FINDER_FADE: ViewpointFade = { ramp: [0.6, 0.2], gate: [30, 12] };

/** Where the visitor is against a viewpoint: `distanceM` on the ground
 *  (height ignored), `offAxisDeg` between the two headings, 0 to 180. */
export interface ViewpointReach {
  readonly distanceM: number;
  readonly offAxisDeg: number;
}

/** Below this length a direction's ground part is too short to carry a
 *  heading (a camera looking nearly straight down or up), and the full
 *  angle between the directions stands in for it. */
const HEADING_MIN = 0.1;

const fwd = new Vector3();
const turn = new Quaternion();

/** The way a viewpoint looks: its rotation applied to local -Z. */
export function viewpointForward(
  viewpoint: TourPictureViewpoint,
  out = new Vector3(),
): Vector3 {
  turn.set(...viewpoint.rotation).normalize();
  return out.set(0, 0, -1).applyQuaternion(turn);
}

function angleDeg(ax: number, ay: number, az: number, b: Vector3): number {
  const la = Math.hypot(ax, ay, az);
  const lb = b.length();
  if (la === 0 || lb === 0) return 180;
  const cos = (ax * b.x + ay * b.y + az * b.z) / (la * lb);
  return (Math.acos(Math.min(1, Math.max(-1, cos))) * 180) / Math.PI;
}

/**
 * The visitor at `viewer` looking along `facing` (both in the viewpoint's
 * frame: north, up, east) against `viewpoint`. A non-finite input gives
 * an infinite distance, which every fade reads as nothing shown.
 */
export function viewpointReach(
  viewer: readonly [number, number, number],
  facing: readonly [number, number, number],
  viewpoint: TourPictureViewpoint,
): ViewpointReach {
  if (![...viewer, ...facing].every(Number.isFinite)) {
    return { distanceM: Infinity, offAxisDeg: 180 };
  }
  const [px, , pz] = viewpoint.position;
  const distanceM = Math.hypot(viewer[0] - px, viewer[2] - pz);
  viewpointForward(viewpoint, fwd);
  const [fx, fy, fz] = facing;
  const groundA = Math.hypot(fx, fz);
  const groundB = Math.hypot(fwd.x, fwd.z);
  const offAxisDeg =
    groundA < HEADING_MIN * Math.hypot(fx, fy, fz) ||
    groundB < HEADING_MIN * fwd.length()
      ? angleDeg(fx, fy, fz, fwd)
      : angleDeg(fx, 0, fz, fwd.setY(0));
  return { distanceM, offAxisDeg };
}

/** The picture's opacity, 0 to 1: the distance ramp times the facing
 *  gate. Anything not finite shows nothing. */
export function viewpointAlpha(
  reach: ViewpointReach,
  fade: ViewpointFade,
): number {
  const { distanceM, offAxisDeg } = reach;
  if (!Number.isFinite(distanceM) || !Number.isFinite(offAxisDeg)) return 0;
  return (
    smoothstep(fade.ramp[0], fade.ramp[1], distanceM) *
    smoothstep(fade.gate[0], fade.gate[1], offAxisDeg)
  );
}
