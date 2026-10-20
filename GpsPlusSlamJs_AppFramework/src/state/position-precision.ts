/**
 * Position PRECISION, judged the same way in every app: how precise the
 * position an app works with is right now, where that precision comes from,
 * and whether it is precise enough to tell two targets apart.
 *
 * - **A code that holds the alignment** (`codeHold`, the app's own
 *   statement) makes an aligned position `'code'`: the most precise there
 *   is, with no number, since nothing measures it as a figure. When a
 *   code's hold ends is the app's: on events (a code judged moved, a new
 *   odometry frame, leaving AR, another tour), never by the clock, by a
 *   count of fixes or by distance - so nothing here reads a time.
 * - **Device fixes** make it `'gps'`, with their reported accuracy: the
 *   median of the latest {@link DEVICE_ACCURACY_WINDOW_FIXES} DEVICE fixes,
 *   by the library's source stamp (`gpsPointSourceOf`). The synthetic
 *   readings a scanned code adds to the store carry a fixed accuracy of
 *   their own, and mixed in they would report a phone in an urban canyon as
 *   precise. A lone raw fix standing in for the position is judged by the
 *   worse of that median and its own accuracy.
 * - **Nothing to judge** is `'none'`: no position, or no code and no device
 *   fix that states an accuracy (codes-only mode once a code's hold ended).
 *
 * Which position an app judges (the aligned camera, a fresh lone fix, or
 * none) and its targets' geometry stay the app's; this module knows nothing
 * about stations or tours. Pure.
 *
 * @see position-precision.ts.md
 */

import { GPS_POINT_SOURCE_DEVICE, gpsPointSourceOf } from '../core/index.js';
import { interpolatingMedian } from '../utils/median.js';

/**
 * Above this reported accuracy (m) a GPS position is too weak to guide by:
 * 25 m, the typical geofence of GPS-only tour products, and the value the
 * Tour Viewer guides by. Equal to it still guides. Swept 10-50 m in
 * `position-precision.sweep.test.ts`: a ceiling only turns a
 * {@link canTellApart} yes into a no, so it never makes that rule unsafe;
 * from 15 m up it changes no verdict there at the shipped factor (targets up
 * to 50 m apart: 1.5 already refuses every accuracy above 16.7 m), and 10 m
 * would refuse wide-spaced targets the rule can tell apart. Targets further
 * apart than 50 m are what would make the ceiling decide.
 */
export const POSITION_PRECISION_CEILING_M = 25;

/**
 * The accuracy is the median of this many latest device fixes that state
 * one: about 10 s at the usual 1 Hz. The median, so one outlier fix neither
 * widens nor narrows anything; ten, so a walk into an urban canyon shows
 * within about five fixes. A window of 3 would follow single bad fixes; 30
 * would keep a good figure for 15 s after the sky closed.
 */
export const DEVICE_ACCURACY_WINDOW_FIXES = 10;

/**
 * The error length (m) a code-held position is judged by in
 * {@link canTellApart}. Never shown: a code-held position shows as "code".
 * Measured at the shipped factor, 1.5: a code tells apart targets from 3 m
 * of spacing, and the sweep's code rows (a constant error per walk plus
 * jitter, in a row, a square and a hex grid of targets) keep every such yes
 * at least 90 % right up to 1 m of constant error with 0.25 m of jitter;
 * the measured error of a code-placed position is 0.3-0.6 m. What reverses
 * it: 1 m of error with 0.5 m of jitter in a grid (87 % square, 83 % hex at
 * 3 m), or a constant error of 1.5 m or more (85 % in a row, 79 % in a hex
 * grid at 3 m). A smaller factor moves the code's yes to closer targets, so
 * this verdict must be re-measured whenever the factor changes.
 */
export const CODE_HELD_ERROR_M = 1;

/**
 * {@link canTellApart}'s factor: two targets can be told apart when this
 * many error lengths fit in half their spacing. 1.5 is the smallest swept
 * factor (0.5-4) whose every yes picks the right target at least 90 % of
 * the time in a row, a square grid AND a hex grid of targets, on an honest
 * accuracy report under the raw-fix Gauss-Markov GPS error the Tour
 * Viewer's station sweeps use (worst yes: row 97 %, square 95 %, hex 93 %).
 * The spacing is the distance to the NEAREST other target, and a grid has
 * four or six of them where a row has two: 1.25 would be enough for a row
 * alone (worst yes 92 %) but says yes at 85 % in a square grid and 82 % in a
 * hex one (`position-precision.sweep.test.ts`; the table is in the
 * sidecar). What would change it: the layout (a row only: 1.25); the goal
 * (80 %: 1.25, 95 %: 1.75, in the worst layout); the report (a phone that
 * reports half its true error needs 3, one that reports double would be
 * safe at 0.75); the noise shape (a smoother error at the same reported
 * accuracy, as an aligned position has, is safe from 1.25 or 0.75).
 */
export const TELL_APART_FACTOR = 1.5;

/** The position an app judges: the aligned camera, or a lone device fix
 *  standing in for it. */
export type PositionKind = 'aligned' | 'lone-fix';

const POSITION_KINDS: readonly unknown[] = ['aligned', 'lone-fix'];

/** What places the position: a code, device fixes, or nothing usable. */
export type PrecisionSource = 'code' | 'gps' | 'none';

/** How precise a position is right now. */
export interface PositionPrecision {
  readonly source: PrecisionSource;
  /** The reported device accuracy (m) for `'gps'`; null for `'code'` (it
   *  shows as "code", never as a number that looks measured) and `'none'`. */
  readonly accuracyM: number | null;
  /** Too weak to guide by: `'none'`, or `'gps'` above the ceiling. Never
   *  for `'code'`. On `'none'` it is a fail-safe, NOT a verdict on GPS (a
   *  tracking drop or location permission off reads the same): a caller
   *  branches on `source` first, and only `'gps'` with `tooWeak` means
   *  "GPS too weak". */
  readonly tooWeak: boolean;
}

/** The fields of a stored GPS reading this module reads (the store's
 *  `GpsPoint` has them). */
export interface PrecisionGpsPoint {
  readonly latLongAccuracy?: number | undefined;
  /** The library's source stamp; absent means a device fix. */
  readonly source?: string;
}

export interface PositionPrecisionInput {
  /** The position the app judges, or null when it has none (no alignment
   *  it may use and no fresh fix, or a tracking drop). Undefined reads as
   *  null; any other value throws. */
  readonly position: PositionKind | null;
  /** The app's statement that a code still holds its alignment. */
  readonly codeHold: boolean;
  /** The store's GPS readings, oldest first; only device fixes are read. */
  readonly gpsPoints: readonly PrecisionGpsPoint[];
  /** For `'lone-fix'`: that fix's own reported accuracy (m), if any.
   *  Ignored for an aligned position. */
  readonly loneFixAccuracyM?: number | null;
  /** Default {@link POSITION_PRECISION_CEILING_M}. */
  readonly ceilingM?: number;
}

export interface CanTellApartOptions {
  /** Default {@link TELL_APART_FACTOR}. */
  readonly factor?: number;
}

const NONE: PositionPrecision = {
  source: 'none',
  accuracyM: null,
  tooWeak: true,
};

/**
 * How precise the position an app judges is now.
 *
 * @throws RangeError when `ceilingM` is given and is not a positive, finite
 *   number of metres, or when `position` is a kind this version does not
 *   know (caller bugs, not data). An undefined `position` reads as null.
 */
export function positionPrecision(
  input: PositionPrecisionInput
): PositionPrecision {
  const ceilingM = checkPositive(
    input.ceilingM ?? POSITION_PRECISION_CEILING_M,
    'ceilingM'
  );
  // `== null`: a plain-JS caller leaving the position undefined has none.
  if (input.position == null) return NONE;
  if (!POSITION_KINDS.includes(input.position)) {
    throw new RangeError(
      `position must be 'aligned', 'lone-fix' or null; got ${String(input.position)}`
    );
  }
  if (input.position === 'aligned' && input.codeHold) {
    return { source: 'code', accuracyM: null, tooWeak: false };
  }
  const median = deviceAccuracyM(input.gpsPoints);
  const accuracyM =
    input.position === 'lone-fix'
      ? worse(median, usableAccuracy(input.loneFixAccuracyM))
      : median;
  if (accuracyM === null) return NONE;
  return { source: 'gps', accuracyM, tooWeak: accuracyM > ceilingM };
}

/**
 * Whether a position this precise can tell apart two targets `spacingM`
 * apart (for a set of targets, the distance to the nearest other one): the
 * factor times the position's error length - the accuracy for `'gps'`,
 * {@link CODE_HELD_ERROR_M} for `'code'` - fits in half the spacing.
 *
 * Never for `'none'` or a position too weak to guide by. A spacing that is
 * zero, negative or NaN never (two targets on one spot cannot be told
 * apart); an infinite one (no other target) always, for a usable position.
 *
 * @throws RangeError when `options.factor` is not a positive, finite number.
 */
export function canTellApart(
  precision: PositionPrecision,
  spacingM: number,
  options: CanTellApartOptions = {}
): boolean {
  const factor = checkPositive(options.factor ?? TELL_APART_FACTOR, 'factor');
  if (precision.tooWeak) return false;
  const lengthM = errorLengthM(precision);
  if (lengthM === null) return false;
  if (Number.isNaN(spacingM) || spacingM <= 0) return false;
  return factor * lengthM <= spacingM / 2;
}

/** The length a precision's error is judged by, or null when it has none. */
function errorLengthM(precision: PositionPrecision): number | null {
  switch (precision.source) {
    case 'code':
      return CODE_HELD_ERROR_M;
    case 'gps':
      return usableAccuracy(precision.accuracyM);
    default:
      return null;
  }
}

/** The median reported accuracy of the latest device fixes, or null when
 *  none states a usable one. */
function deviceAccuracyM(points: readonly PrecisionGpsPoint[]): number | null {
  const recent: number[] = [];
  for (let i = points.length - 1; i >= 0; i -= 1) {
    const p = points[i]!;
    if (gpsPointSourceOf(p) !== GPS_POINT_SOURCE_DEVICE) continue;
    const accuracy = usableAccuracy(p.latLongAccuracy);
    if (accuracy === null) continue;
    recent.push(accuracy);
    if (recent.length === DEVICE_ACCURACY_WINDOW_FIXES) break;
  }
  return recent.length === 0 ? null : interpolatingMedian(recent);
}

/** A reported accuracy a position can be judged by: finite and positive
 *  (external data: anything else is no accuracy at all). */
function usableAccuracy(accuracy: unknown): number | null {
  return typeof accuracy === 'number' &&
    Number.isFinite(accuracy) &&
    accuracy > 0
    ? accuracy
    : null;
}

/** The worse of two accuracies; an unknown one gives way to a known one. */
function worse(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.max(a, b);
}

function checkPositive(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(
      `${name} must be a positive, finite number; got ${String(value)}`
    );
  }
  return value;
}
