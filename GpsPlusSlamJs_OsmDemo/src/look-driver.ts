/**
 * The time-of-day blend's rule: the look weights the sun's elevation shows.
 * Pure and free of three.js, so the store's selector and the property tests
 * run it in node.
 *
 * THE RULE. Each limb of the day is a list of keyframe points from high to
 * low elevation, each naming one look (`TIME_OF_DAY_LOOKS`); between two
 * points the weights move linearly from the first look to the second, and
 * two points of the same look are a plateau. Above the first point the first
 * look holds, below the last the last. The evening runs day, golden hour,
 * dusk, blue hour; the morning mirrors it without dusk (dusk is the evening
 * after rain), so blue hour blends straight to golden hour.
 *
 * THE FLIP. Which list applies is apparent solar time before or after solar
 * noon (`isMorningAt`), never an elevation difference, so it flips exactly
 * twice a day and never on noise. The flip is continuous wherever both lists
 * agree: at noon when the sun is at least `agreementBounds().above` high,
 * at midnight when it is at most `agreementBounds().below` low. With the
 * shipped points that holds below about 63 degrees of latitude (between
 * about 55.6 and 63 when one point of one limb moves by 2 degrees); above it the
 * weights jump at the flip.
 *
 * @see look-driver.ts.md
 */

import { apparentSolarTimeHours } from "gps-plus-slam-app-framework/geo/solar-position";

import { TIME_OF_DAY_LOOKS } from "./look-choice.js";

/** One point of a limb: at `elevationDeg` the look `look` (an index into `TIME_OF_DAY_LOOKS`) shows alone. */
export interface LookKeyframe {
  readonly elevationDeg: number;
  readonly look: number;
}

/** The two limbs' point lists, each from high to low elevation. */
export interface LookKeyframes {
  readonly evening: readonly LookKeyframe[];
  readonly morning: readonly LookKeyframe[];
}

const DAY = TIME_OF_DAY_LOOKS.indexOf("today");
const GOLDEN = TIME_OF_DAY_LOOKS.indexOf("golden");
const DUSK = TIME_OF_DAY_LOOKS.indexOf("dusk");
const BLUE = TIME_OF_DAY_LOOKS.indexOf("bluehour");

const point = (elevationDeg: number, look: number): LookKeyframe =>
  Object.freeze({ elevationDeg, look });

/**
 * The shipped points. Evening: day at 9 degrees and above, a blend to golden
 * hour 9 to 6, golden plateau 6 to 2, a blend to dusk 2 to 0, dusk plateau
 * 0 to -2, a blend to blue hour -2 to -3.5, blue hour below. Morning: the
 * same without the dusk points, so blue hour blends to golden over -3.5 to 2.
 */
export const LOOK_KEYFRAMES: LookKeyframes = Object.freeze({
  evening: Object.freeze([
    point(9, DAY),
    point(6, GOLDEN),
    point(2, GOLDEN),
    point(0, DUSK),
    point(-2, DUSK),
    point(-3.5, BLUE),
  ]),
  morning: Object.freeze([
    point(9, DAY),
    point(6, GOLDEN),
    point(2, GOLDEN),
    point(-3.5, BLUE),
  ]),
});

/**
 * Checks a limb's points: at least one, every elevation finite, every look
 * an index into `TIME_OF_DAY_LOOKS`, elevations from high to low (equal
 * neighbours allowed: a hard step). RangeError otherwise.
 */
export function validateKeyframes(points: readonly LookKeyframe[]): void {
  if (points.length === 0) throw new RangeError("a limb needs a keyframe");
  for (const [i, p] of points.entries()) {
    if (!Number.isFinite(p.elevationDeg)) {
      throw new RangeError(`keyframe ${i} has elevation ${p.elevationDeg}`);
    }
    if (
      !Number.isInteger(p.look) ||
      p.look < 0 ||
      p.look >= TIME_OF_DAY_LOOKS.length
    ) {
      throw new RangeError(`keyframe ${i} names look ${p.look}`);
    }
    const before = points[i - 1];
    if (before !== undefined && p.elevationDeg > before.elevationDeg) {
      throw new RangeError(
        `keyframes must run from high to low; ${i} rises to ${p.elevationDeg}`,
      );
    }
  }
}

/**
 * The look weights at a sun elevation: one per `TIME_OF_DAY_LOOKS` entry,
 * each in [0, 1], summing to 1, at most two of them non-zero. RangeError for
 * an elevation that is not finite or points `validateKeyframes` refuses.
 */
export function lookWeightsAt(
  elevationDeg: number,
  isMorning: boolean,
  keyframes: LookKeyframes = LOOK_KEYFRAMES,
): readonly number[] {
  if (!Number.isFinite(elevationDeg)) {
    throw new RangeError(`sun elevation must be finite, got ${elevationDeg}`);
  }
  const points = isMorning ? keyframes.morning : keyframes.evening;
  validateKeyframes(points);
  const weights = TIME_OF_DAY_LOOKS.map(() => 0);
  const first = points[0]!;
  const last = points[points.length - 1]!;
  if (elevationDeg >= first.elevationDeg) {
    weights[first.look] = 1;
  } else if (elevationDeg <= last.elevationDeg) {
    weights[last.look] = 1;
  } else {
    mixBetweenPoints(points, elevationDeg, weights);
  }
  return Object.freeze(weights);
}

/**
 * Adds the weights of the first pair of points around `elevationDeg` (inside
 * the limb's range) to `weights`: linear between them, all on the lower one
 * where the two share an elevation (a hard step).
 */
function mixBetweenPoints(
  points: readonly LookKeyframe[],
  elevationDeg: number,
  weights: number[],
): void {
  for (let i = 0; i + 1 < points.length; i++) {
    const high = points[i]!;
    const low = points[i + 1]!;
    if (elevationDeg > high.elevationDeg || elevationDeg < low.elevationDeg) {
      continue;
    }
    const span = high.elevationDeg - low.elevationDeg;
    const t = span > 0 ? (high.elevationDeg - elevationDeg) / span : 1;
    weights[high.look] = (weights[high.look] ?? 0) + (1 - t);
    weights[low.look] = (weights[low.look] ?? 0) + t;
    return;
  }
}

/**
 * Whether an instant is the morning limb at a longitude: apparent solar time
 * before solar noon (the sun clock's hour angle). RangeError for a value
 * that is not finite (from the solar model).
 */
export function isMorningAt(ms: number, lngDeg: number): boolean {
  return apparentSolarTimeHours(ms, lngDeg) < 12;
}

/**
 * Where the two limbs agree: strictly above `above` and strictly below
 * `below` the morning and the evening give the same weights, so the flip at
 * noon (the sun higher than `above`) and at midnight (lower than `below`) is
 * continuous. Derived from the points, not fixed: the edges of the
 * elevations at which the lists differ. With the shipped points the lists
 * also agree AT both edges (2 and -3.5 degrees).
 */
export function agreementBounds(keyframes: LookKeyframes = LOOK_KEYFRAMES): {
  readonly above: number;
  readonly below: number;
} {
  const samples = [
    ...keyframes.evening.map((p) => p.elevationDeg),
    ...keyframes.morning.map((p) => p.elevationDeg),
  ];
  const differs = (e: number) => {
    const a = lookWeightsAt(e, false, keyframes);
    const b = lookWeightsAt(e, true, keyframes);
    return a.some((w, k) => Math.abs(w - (b[k] ?? 0)) > 1e-12);
  };
  // Between two neighbouring sample elevations both lists are linear, so
  // they differ inside a gap exactly when they differ in its middle; the
  // gap's ends are then the edges of the differing set.
  const sorted = [...new Set(samples)].sort((x, y) => y - x);
  const edges: number[] = sorted.filter(differs);
  for (let i = 0; i + 1 < sorted.length; i++) {
    const high = sorted[i]!;
    const low = sorted[i + 1]!;
    if (differs((high + low) / 2)) edges.push(high, low);
  }
  if (edges.length === 0) return { above: -Infinity, below: Infinity };
  return { above: Math.max(...edges), below: Math.min(...edges) };
}
