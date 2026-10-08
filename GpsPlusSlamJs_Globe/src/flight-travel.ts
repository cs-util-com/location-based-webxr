/**
 * The continuous flight's curve (round-2 plan 2026-10-07-2350, DEC-FR2-1
 * and DEC-FR2-2, as revised by its cold review): from the camera's altitude
 * to the landing along one great circle, turning first and diving after,
 * with the view looking where the camera goes. Pure: altitudes and the arc
 * in; the share of the arc travelled, the altitude and the view's pitch by
 * path length out.
 *
 * THE OWNER asked (2026-10-07, on r793): "the camera must always look in the
 * direction of flight; that direction should END at 45 degrees", and "turn
 * first, then a curve: straight towards the Earth's centre, then bending".
 *
 * THE LAW. The flight-path angle (how far below its horizontal the camera
 * moves) is a law of altitude, `travelLawDeg`: 90 (straight down) from the
 * bend up, easing in the altitude's logarithm to 45 at the landing. The
 * dive's ground track follows from it (d ground = cot(angle) d h), so a
 * camera on that track moves exactly at the law's angle; it ends one landing
 * behind the target, travelling and looking at it 45 degrees down.
 *
 * THE CURVE, in the altitude's logarithm from the start to the landing: the
 * ground left to fly is the dive's track at that altitude plus a residual
 * that dies out as a power (`turnPower`) of the altitude's logarithm left
 * to a FIXED end: the bend for a start above it (the residual is the turn,
 * done above the bend), else the bend's and the landing's geometric middle,
 * else the landing. Self-similar, so a replan that changes nothing flies
 * on exactly (the power law from any point on it is itself): a turn eased
 * over a window from the start reshaped the rest at every replan. A start
 * nearer the target than the dive's own track backs off by the same term.
 *
 * THE VIEW. Above the bend the camera looks straight down at the Earth (the
 * turn the owner asked for first; looking along it would show the horizon).
 * Below it, the view's pitch is the camera's ACTUAL direction of travel,
 * residual included, but never shallower than the law (the dive's own
 * angle: in the dive the two agree), never nearer the horizon than
 * `horizonMarginDeg`.
 *
 * THE MEASURE. Path length is the CF1 criterion's, ds^2 = (d ln h)^2 +
 * (ground / h)^2 with the ground on the mean radius, so `flight-path`'s clock
 * and the replans' speed match keep working.
 *
 * @see flight-travel.ts.md
 */

import { smoothstep } from "./globe-ease.js";

export const FLIGHT_TRAVEL = Object.freeze({
  /** The bend's altitude: above it the camera travels straight down, m. */
  bendM: 100_000,
  /** The bend is at least this many landings up (a high landing bends higher). */
  bendLandings: 25,
  /** The flight-path angle at the landing, degrees (the owner's 45). */
  landingAngleDeg: 45,
  /**
   * The residual (high up, the turn) dies out as (log altitude left to its
   * end)^this: front-loaded, and C2 into the dive at the end.
   */
  turnPower: 3,
  /**
   * A start must lie above its turn's end by e-folds of descent in
   * proportion to the turn it has left (its sideways distance over its
   * altitude, x this), between `endMarginEFolds` and `maxMarginEFolds`;
   * else the next end down. A big turn from a start just above the bend
   * crammed into a sliver of descent and turned into the dive at a corner
   * (the speed read 0.79 there); along an existing curve the turn left at a
   * replan is tiny (it dies out as a cube), so a replan finds the same end.
   * 0.1 and at most 0.5 (the R1 re-review's sweep): 0.5 and at most 2
   * spilled big turns below the bend for starts up to 739 km (the view 70-89
   * degrees off the travel there) and sent replans from them off their curve.
   */
  marginPerTurn: 0.1,
  /** At least this (a start a hair above the bend stalled in a 1e-15 window). */
  endMarginEFolds: 0.01,
  /** At most this. */
  maxMarginEFolds: 0.5,
  /** The least the view looks below the horizon, degrees. */
  horizonMarginDeg: 5,
  /** Intervals of the curve's table (each interpolated as a cubic). */
  samples: 1_024,
  /** The mean radius the ground distance is taken on, m. */
  radiusM: 6_371_000,
});

const DEG = Math.PI / 180;

function requirePositive(name: string, value: number): void {
  if (!(value > 0 && Number.isFinite(value))) {
    throw new RangeError(`${name} must be a positive number, got ${value}`);
  }
}

/** The bend's altitude for a landing: `bendM`, or `bendLandings` landings. */
export function bendAltitudeM(landingM: number): number {
  requirePositive("landingM", landingM);
  return Math.max(FLIGHT_TRAVEL.bendM, FLIGHT_TRAVEL.bendLandings * landingM);
}

/**
 * The flight-path angle at `altitudeM` for a flight landing at `landingM`,
 * degrees below the horizontal: 90 from the bend up, `landingAngleDeg` at
 * the landing and below, a smoothstep in the altitude's logarithm between.
 * RangeError for an altitude or landing that is not a positive number.
 */
export function travelLawDeg(altitudeM: number, landingM: number): number {
  requirePositive("altitudeM", altitudeM);
  const bend = bendAltitudeM(landingM);
  if (altitudeM >= bend) return 90;
  const land = FLIGHT_TRAVEL.landingAngleDeg;
  if (altitudeM <= landingM) return land;
  const x = Math.log(altitudeM / landingM) / Math.log(bend / landingM);
  return land + (90 - land) * smoothstep(x);
}

/** A cubic Hermite between (0, a, slope ma) and (1, b, slope mb), at u. */
function hermite(a: number, b: number, ma: number, mb: number, u: number) {
  const u2 = u * u;
  const u3 = u2 * u;
  return (
    (2 * u3 - 3 * u2 + 1) * a +
    (u3 - 2 * u2 + u) * ma +
    (-2 * u3 + 3 * u2) * b +
    (u3 - u2) * mb
  );
}

/** One point of the curve. */
interface TravelPoint {
  /** The share of the arc travelled, 0 at the start, 1 at the end. */
  readonly share: number;
  /** The ground angle travelled along the course, signed, rad. */
  readonly angle: number;
  /** The share of the residual (high up, the turn) still to fly, 1 to 0. */
  readonly residualLeft: number;
  /** The camera's altitude, m. */
  readonly h: number;
}

/** A planned curve, by path length in [0, length]. */
export interface TravelCurve {
  readonly length: number;
  /** The dive's own ground track from the bend (or the start) down, rad. */
  readonly diveArcRad: number;
  readonly at: (s: number) => TravelPoint;
  /** The view's pitch below the camera's horizontal, degrees. */
  readonly pitchAt: (s: number) => number;
}

/**
 * The table's knots in sigma: half of them inside the residual's window
 * and half after it, so a window of a sliver (a start a hair above the
 * bend) is resolved as finely as a whole curve.
 */
function knotsFor(n: number, window: number): Float64Array {
  const knots = new Float64Array(n + 1);
  const half = n / 2;
  const split = window > 1e-12 && window < 1 - 1e-12;
  for (let k = 0; k <= n; k++) {
    knots[k] = !split
      ? k / n
      : k <= half
        ? (window * k) / half
        : window + ((1 - window) * (k - half)) / half;
  }
  return knots;
}

/** The interval of an increasing `table` holding `x`. */
function intervalOf(table: Float64Array, x: number): number {
  let lo = 0;
  let hi = table.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if ((table[mid] ?? 0) <= x) lo = mid;
    else hi = mid;
  }
  return lo;
}

/**
 * The cumulative integral of `f` over the knots (Simpson on each interval):
 * from 0 at the first knot, or, `fromEnd`, from 0 at the last backwards.
 */
function integralTable(
  knots: Float64Array,
  f: (sigma: number) => number,
  fromEnd: boolean,
): Float64Array {
  const n = knots.length - 1;
  const table = new Float64Array(n + 1);
  const piece = (k: number) => {
    const a = knots[k] ?? 0;
    const b = knots[k + 1] ?? 0;
    return ((f(a) + 4 * f((a + b) / 2) + f(b)) / 6) * (b - a);
  };
  if (fromEnd) {
    for (let k = n - 1; k >= 0; k--) table[k] = (table[k + 1] ?? 0) + piece(k);
  } else {
    for (let k = 0; k < n; k++) table[k + 1] = (table[k] ?? 0) + piece(k);
  }
  return table;
}

/**
 * sigma by path length from the cumulative `lengths` table: a cubic Hermite
 * through it, its slopes the exact 1 / (ds / dsigma) (`speed`), so the
 * motion has no kink at the knots.
 */
function inverseByLength(
  knots: Float64Array,
  lengths: Float64Array,
  speed: (sigma: number) => number,
): (pathS: number) => number {
  const length = lengths[lengths.length - 1] ?? 0;
  return (pathS) => {
    if (pathS <= 0) return 0;
    if (pathS >= length) return 1;
    const lo = intervalOf(lengths, pathS);
    const sa = lengths[lo] ?? 0;
    const span = (lengths[lo + 1] ?? 0) - sa;
    const a = knots[lo] ?? 0;
    const width = (knots[lo + 1] ?? 0) - a;
    if (!(span > 0)) return a;
    // In the interval's own units: d(sigma / width) / d(u) = span / (width
    // speed), capped at 3 (Fritsch and Carlson) so the cubic stays monotone
    // where the speed changes many times over within one interval (the
    // bottom of a steep climb), at the price of a corner there.
    const ma = Math.min(3, span / (width * speed(a)));
    const mb = Math.min(3, span / (width * speed(a + width)));
    return a + width * hermite(0, 1, ma, mb, (pathS - sa) / span);
  };
}

/** The view's pitch held between the horizon floor and straight down. */
function clampPitch(deg: number, h: number): number {
  const R = FLIGHT_TRAVEL.radiusM;
  const floor =
    Math.acos(R / (R + Math.max(0, h))) / DEG + FLIGHT_TRAVEL.horizonMarginDeg;
  return Math.min(90, Math.max(floor, deg));
}

/**
 * A pan at the landing's altitude (a replan that is already there): the view
 * looks by the law of its landing (45 degrees at a landing), as the flight
 * ends.
 */
function levelPan(arcRad: number, h1: number, landingM: number): TravelCurve {
  const length = (Math.abs(arcRad) * FLIGHT_TRAVEL.radiusM) / h1;
  return {
    length,
    diveArcRad: 0,
    at: (s) => {
      const share = length > 0 ? Math.min(1, Math.max(0, s / length)) : 1;
      return { share, angle: share * arcRad, residualLeft: 1 - share, h: h1 };
    },
    pitchAt: () => clampPitch(travelLawDeg(h1, landingM), h1),
  };
}

/**
 * The curve from `h0` down to `h1` over `arcRad` of ground along the course
 * (signed: the camera's own arc to its end, one landing behind the target;
 * negative when that end lies behind the start), its law that of
 * `landingM` (the flight's real landing: a hold that stops short passes it).
 * A start at the landing's altitude is a pure pan. RangeError for altitudes
 * that are not positive or an arc that is not finite.
 */
export function planTravel(
  h0: number,
  h1: number,
  arcRad: number,
  options: { readonly landingM: number },
): TravelCurve {
  requirePositive("h0", h0);
  requirePositive("h1", h1);
  requirePositive("landingM", options.landingM);
  if (!Number.isFinite(arcRad)) {
    throw new RangeError(`the arc must be finite, got ${arcRad}`);
  }
  const dw = Math.log(h1) - Math.log(h0);
  if (Math.abs(dw) < 1e-9) return levelPan(arcRad, h1, options.landingM);
  const R = FLIGHT_TRAVEL.radiusM;
  const bend = bendAltitudeM(options.landingM);
  const hAt = (sigma: number) => h0 * Math.exp(dw * sigma);
  // The dive's track: d(ground angle) / d(ln h) = cot(angle) h / (R + h),
  // from the landing up. A climb (a landing raised over the camera) has none.
  const diveSlopeW = (h: number) => {
    if (dw > 0) return 0;
    const angle = travelLawDeg(h, options.landingM) * DEG;
    return ((Math.cos(angle) / Math.sin(angle)) * h) / (R + h);
  };
  const diveSlope = (sigma: number) => diveSlopeW(hAt(sigma)) * dw;
  // The residual's end, as a share of the curve: a FIXED altitude below the
  // start (the bend, else the bend's and the landing's geometric middle, else
  // the landing), so a replan in the same band ends it at the same place,
  // and one in a lower band finds it done. A climb absorbs it over the whole.
  // The dive's track from the start (on an even grid, for the margin), the
  // residual, and the start's margin above its end by the turn it has left.
  const dive =
    integralTable(
      knotsFor(FLIGHT_TRAVEL.samples, 1),
      (sigma) => -diveSlope(sigma),
      true,
    )[0] ?? 0;
  const marginEFolds = Math.min(
    FLIGHT_TRAVEL.maxMarginEFolds,
    Math.max(
      FLIGHT_TRAVEL.endMarginEFolds,
      (FLIGHT_TRAVEL.marginPerTurn * R * Math.abs(arcRad - dive)) / h0,
    ),
  );
  const margin = Math.exp(-marginEFolds);
  const end =
    dw > 0
      ? h1
      : ([bend, Math.sqrt(bend * h1)].find((e) => e < h0 * margin) ?? h1);
  const window = Math.min(1, Math.log(end / h0) / dw);
  const knots = knotsFor(FLIGHT_TRAVEL.samples, window);
  // g(sigma), the dive's track left, on the curve's own knots, and the
  // residual by it (so the curve starts exactly where the camera is).
  const g = integralTable(knots, (sigma) => -diveSlope(sigma), true);
  const residual = arcRad - (g[0] ?? 0);
  const gAt = (sigma: number) => {
    const k = intervalOf(knots, sigma);
    const a = knots[k] ?? 0;
    const width = (knots[k + 1] ?? 1) - a;
    const u = width > 0 ? (sigma - a) / width : 0;
    return hermite(
      g[k] ?? 0,
      g[k + 1] ?? 0,
      diveSlope(a) * width,
      diveSlope(a + width) * width,
      u,
    );
  };
  const p = FLIGHT_TRAVEL.turnPower;
  // q(sigma): the share of the residual still to fly, and its slope. A
  // climb (a landing raised over the camera) eases it over its whole path
  // instead: front-loaded, its sideways motion came at its lowest altitude.
  const q = (sigma: number) =>
    dw > 0
      ? 1 - smoothstep(sigma)
      : sigma >= window
        ? 0
        : (1 - sigma / window) ** p;
  const qSlope = (sigma: number) =>
    dw > 0
      ? -6 * sigma * (1 - sigma)
      : sigma >= window
        ? 0
        : (-p * (1 - sigma / window) ** (p - 1)) / window;
  // The ground left, and its slope in sigma (negative while approaching).
  const left = (sigma: number) => gAt(sigma) + residual * q(sigma);
  const leftSlope = (sigma: number) =>
    diveSlope(sigma) + residual * qSlope(sigma);
  // d(path length) / d(sigma) in the CF1 measure.
  const speed = (sigma: number) =>
    Math.hypot(dw, (R * leftSlope(sigma)) / hAt(sigma));
  const lengths = integralTable(knots, speed, false);
  const sigmaAt = inverseByLength(knots, lengths, speed);
  const point = (sigma: number): TravelPoint => {
    const angle = arcRad - left(sigma);
    return {
      share: arcRad !== 0 ? angle / arcRad : 1,
      angle,
      residualLeft: q(sigma),
      h: hAt(sigma),
    };
  };
  return {
    length: lengths[lengths.length - 1] ?? 0,
    diveArcRad: g[0] ?? 0,
    at: (pathS) => {
      const sigma = sigmaAt(pathS);
      if (sigma >= 1) {
        return { share: 1, angle: arcRad, residualLeft: 0, h: h1 };
      }
      if (sigma <= 0) return { share: 0, angle: 0, residualLeft: 1, h: h0 };
      return point(sigma);
    },
    pitchAt: (pathS) => {
      const sigma = sigmaAt(pathS);
      if (sigma >= 1) return clampPitch(travelLawDeg(h1, options.landingM), h1);
      const h = hAt(sigma);
      if (h >= bend) return 90;
      const law = travelLawDeg(h, options.landingM);
      // A climb travels up; it looks by the law instead (45 at a landing
      // below the bend), so it ends where the landing looks, without a snap.
      if (dw > 0) return clampPitch(law, h);
      // The camera's actual motion: down by -dh, ahead by (R + h) d theta.
      // The view follows it, but never shallower than the law: where the
      // camera still moves sideways (a turn below the bend, a residual low
      // down, a nearly level replan at the end) a view on the travel looked
      // at the horizon and snapped down at the end (the R1 milestone review:
      // up to 75 degrees in a frame). In the dive itself the two agree.
      const travel = Math.atan2(-h * dw, (R + h) * -leftSlope(sigma)) / DEG;
      return clampPitch(Math.max(travel, law), h);
    },
  };
}
