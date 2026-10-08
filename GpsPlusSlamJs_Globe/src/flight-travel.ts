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
 * residual included, never nearer the horizon than `horizonMarginDeg`.
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
  /** A start this many e-folds above an end at least, or the next end down. */
  endMarginEFolds: 0.5,
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

/** d smoothstep / dx. */

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
 * The cumulative integral of `f` over [0, 1] on `n` intervals (Simpson on
 * each): from 0 at sigma 0, or, `fromEnd`, from 0 at sigma 1 backwards.
 */
function integralTable(
  n: number,
  f: (sigma: number) => number,
  fromEnd: boolean,
): Float64Array {
  const table = new Float64Array(n + 1);
  const piece = (k: number) =>
    (f(k / n) + 4 * f((k + 0.5) / n) + f((k + 1) / n)) / (6 * n);
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
  lengths: Float64Array,
  n: number,
  speed: (sigma: number) => number,
): (pathS: number) => number {
  const length = lengths[n] ?? 0;
  return (pathS) => {
    if (pathS <= 0) return 0;
    if (pathS >= length) return 1;
    let lo = 0;
    let hi = n;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if ((lengths[mid] ?? 0) <= pathS) lo = mid;
      else hi = mid;
    }
    const sa = lengths[lo] ?? 0;
    const span = (lengths[hi] ?? 0) - sa;
    if (!(span > 0)) return lo / n;
    // In the interval's own units: d(sigma n) / d(u) = n span / speed,
    // capped at 3 (Fritsch and Carlson) so the cubic stays monotone where
    // the speed changes many times over within one interval (the bottom of
    // a steep climb), at the price of a corner there.
    const ma = Math.min(3, (n * span) / speed(lo / n));
    const mb = Math.min(3, (n * span) / speed(hi / n));
    return (lo + hermite(0, 1, ma, mb, (pathS - sa) / span)) / n;
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
 * ends; at the level travel's horizon floor, a replan in a flight's last
 * milliseconds snapped the view up by about 40 degrees.
 */
function levelPan(arcRad: number, h1: number, landingM: number): TravelCurve {
  const length = (Math.abs(arcRad) * FLIGHT_TRAVEL.radiusM) / h1;
  return {
    length,
    diveArcRad: 0,
    at: (s) => ({
      share: length > 0 ? Math.min(1, Math.max(0, s / length)) : 1,
      h: h1,
    }),
    pitchAt: () => clampPitch(travelLawDeg(h1, landingM), h1),
  };
}

/**
 * The curve from `h0` down to `h1` over `arcRad` of ground (the camera's
 * own arc to its end, one landing behind the target), its law that of
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
  const n: number = FLIGHT_TRAVEL.samples;
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
  // g(sigma), the dive's track left, and the residual's window.
  const g = integralTable(n, (sigma) => -diveSlope(sigma), true);
  const dive = g[0] ?? 0;
  const residual = arcRad - dive;
  // The residual's end, as a share of the curve: a fixed altitude, so the
  // same for a replan in the same band (a climb absorbs it over the whole).
  const margin = Math.exp(-FLIGHT_TRAVEL.endMarginEFolds);
  const end =
    dw > 0
      ? h1
      : ([bend, Math.sqrt(bend * h1)].find((e) => e < h0 * margin) ?? h1);
  const window = Math.min(1, Math.log(end / h0) / dw);
  const gAt = (sigma: number) => {
    const k = Math.min(n - 1, Math.floor(sigma * n));
    const u = sigma * n - k;
    const ga = g[k] ?? 0;
    const gb = g[k + 1] ?? 0;
    return hermite(ga, gb, diveSlope(k / n) / n, diveSlope((k + 1) / n) / n, u);
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
  const lengths = integralTable(n, speed, false);
  const sigmaAt = inverseByLength(lengths, n, speed);
  return {
    length: lengths[n] ?? 0,
    diveArcRad: dive,
    at: (pathS) => {
      const sigma = sigmaAt(pathS);
      if (sigma >= 1) return { share: 1, h: h1 };
      if (sigma <= 0) return { share: 0, h: h0 };
      const share = arcRad !== 0 ? 1 - left(sigma) / arcRad : 1;
      return { share, h: hAt(sigma) };
    },
    pitchAt: (pathS) => {
      const sigma = sigmaAt(pathS);
      if (sigma >= 1) return clampPitch(travelLawDeg(h1, options.landingM), h1);
      const h = hAt(sigma);
      if (h >= bend) return 90;
      // A climb travels up; it looks by the law instead (45 at a landing
      // below the bend), so it ends where the landing looks, without a snap.
      if (dw > 0) return clampPitch(travelLawDeg(h, options.landingM), h);
      // The camera's actual motion: down by -dh, ahead by (R + h) d theta.
      return clampPitch(
        Math.atan2(-h * dw, (R + h) * -leftSlope(sigma)) / DEG,
        h,
      );
    },
  };
}
