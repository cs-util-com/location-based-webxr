/**
 * Two fingers on the 3D view move the camera only (the design's, as in
 * map apps): side by side, moved up or down together, they tilt it;
 * anything else pinches (zoom), pans (the ground under the fingers stays
 * under them) and twists (turns). The kind is decided once the fingers
 * moved past a dead zone, and kept until they lift. Pure: the input feeds
 * the fingers and holds the kind it decided.
 *
 * @see two-finger.ts.md
 */

/** A finger on the screen (CSS px). */
interface Finger {
  readonly x: number;
  readonly y: number;
}

/** The two fingers, in the order they touched. */
export type FingerPair = readonly [Finger, Finger];

/** The design's numbers. */
export const TWO_FINGER = Object.freeze({
  /** How far a finger moves before the kind is decided (px). */
  deadPx: 10,
  /** A finger that moved less than this is still (px)... */
  stillPx: 4,
});

/** How far past the dead zone one finger must go while the other stays
 *  still (a pinch against a still thumb), as a multiple of the zone. */
const ALONE_FACTOR = 2.5;
/** A finger's rise must be this many times its sideways move to count as
 *  vertical. */
const VERTICAL_RATIO = 1.8;
/** The spread a tilt may change, as a fraction of the rise, plus px. */
const SPREAD_FRACTION = 0.35;
const SPREAD_SLACK_PX = 3;

const delta = (a: Finger, b: Finger) => ({ x: b.x - a.x, y: b.y - a.y });
const length = (d: { x: number; y: number }) => Math.hypot(d.x, d.y);

/**
 * The gesture the fingers make from `start` to `now`: `tilt` (side by
 * side, up or down together), `map` (pinch, pan, twist), or null while
 * undecided (inside the dead zone, or one finger moved and the other has
 * not yet: pointer events come one finger at a time).
 */
export function twoFingerMode(
  start: FingerPair,
  now: FingerPair,
  deadPx: number = TWO_FINGER.deadPx,
): "tilt" | "map" | null {
  const da = delta(start[0], now[0]);
  const db = delta(start[1], now[1]);
  const ma = length(da);
  const mb = length(db);
  if (Math.max(ma, mb) < deadPx) return null;
  if (
    Math.min(ma, mb) < TWO_FINGER.stillPx &&
    Math.max(ma, mb) < ALONE_FACTOR * deadPx
  ) {
    return null;
  }
  const spread = Math.abs(
    length(delta(now[0], now[1])) - length(delta(start[0], start[1])),
  );
  const vertical =
    da.y * db.y > 0 &&
    Math.abs(da.y) > VERTICAL_RATIO * Math.abs(da.x) &&
    Math.abs(db.y) > VERTICAL_RATIO * Math.abs(db.x);
  const parallel =
    spread <
    (SPREAD_FRACTION * (Math.abs(da.y) + Math.abs(db.y))) / 2 + SPREAD_SLACK_PX;
  return vertical && parallel ? "tilt" : "map";
}
