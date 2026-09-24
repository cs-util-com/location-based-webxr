/**
 * The geographic bearing of a direction in the GPS-world NUE frame, degrees
 * clockwise from north. Lifted from OsmDemo's `ar-origin.ts` (2026-09-24,
 * DEC-H3): the AR sun check needs the same conversion, and one shared copy
 * keeps the axis convention in one place.
 *
 * THE FRAME IS THE WHOLE RISK, so it is stated rather than implied: the
 * framework's scene root is NUE (`X = North`, `Y = Up`, `Z = East`). A camera
 * direction must be taken in WORLD space (the camera is a descendant of
 * `arWorldGroup`, which carries the alignment); a direction relative to
 * `arWorldGroup` is in the AR-odometry frame and is not a compass reading.
 *
 * @see nue-bearing.ts.md
 */
import { normalizeBearingDeg } from './bearing-degrees.js';

/**
 * @param north the direction's north component (three.js world `x`).
 * @param east the direction's east component (three.js world `z`).
 * @returns bearing in `[0, 360)`, or `undefined` for a degenerate direction:
 *   straight up or down has no bearing, and reporting `0` for it would be a
 *   confident claim of "facing north".
 */
export function nueBearingDeg(north: number, east: number): number | undefined {
  if (!Number.isFinite(north) || !Number.isFinite(east)) return undefined;
  // A vertical direction projects to nothing on the horizontal plane. The
  // threshold is generous: below this the bearing is numerical noise that
  // would spin a readout while the user holds the phone still, pointed down.
  if (Math.hypot(north, east) < 1e-6) return undefined;
  return normalizeBearingDeg((Math.atan2(east, north) * 180) / Math.PI);
}
