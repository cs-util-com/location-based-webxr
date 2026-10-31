/**
 * The approach on opening a tour in the globe editor, pure: the camera
 * starts high above the Earth, turns the globe towards the tour and falls
 * to the street view, and a progress bar follows its height. Time in, a
 * view pose and the bar's value out; a station picked mid-flight retargets
 * the flight from wherever the camera is.
 *
 * - The height over the tour's ground falls evenly in its logarithm (every
 *   halving takes as long as the one before), eased at both ends, so the
 *   fall never reverses and never looks stuck.
 * - The place and the heading move over the first `turnShare` of the
 *   flight, the short way round, so the turn is done while the camera is
 *   still high.
 * - The pitch is held straight down until `pitchShare` and then eases to
 *   the goal's, so the last stretch tips up to the street.
 * - The bar's value is read from the height alone: 0 at the flight's first
 *   height, 1 at the goal's, on the same logarithmic scale.
 *
 * @see globe-approach-flight.ts.md
 */
import type { GlobeViewPose } from "gps-plus-slam-globe/view";

export const GLOBE_APPROACH = Object.freeze({
  /** The flight's first height over the tour's ground (km): the whole
   *  Earth in view at the editor's 50 degree lens. */
  startHeightKm: 8_000,
  /** The flight starts this far west and south of its goal (deg), so the
   *  globe visibly turns towards the tour. */
  startOffsetLngDeg: 35,
  startOffsetLatDeg: 12,
  /** The whole flight (ms): inside the owner's 10 to 20 s. */
  durationMs: 13_000,
  /** The flight under `prefers-reduced-motion` (ms). */
  reducedDurationMs: 2_000,
  /** The share of the flight spent turning towards the goal. */
  turnShare: 0.4,
  /** The pitch is straight down until this share of the flight. */
  pitchShare: 0.7,
  /** A retarget never flies for less than this (ms). */
  retargetMinMs: 1_500,
});

/** One flight: from a pose to a goal, both over a ground height. */
export interface ApproachFlight {
  readonly from: GlobeViewPose;
  readonly to: GlobeViewPose;
  /** The ground's height over the ellipsoid under the goal (m). */
  readonly groundM: number;
  readonly durationMs: number;
  readonly pitchShare: number;
  /** The height (m over the ground) the bar reads as 0: the first
   *  flight's, kept through a retarget so the bar never runs back. */
  readonly barFromM: number;
}

/** The camera's height over the ground (m), never below 1 cm: a log
 *  scale needs a positive height. */
function heightOver(pose: GlobeViewPose, groundM: number): number {
  return Math.max(0.01, pose.altitudeKm * 1000 - groundM);
}

function smoothstep01(x: number): number {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
}

/** The signed short way from `a` to `b` (deg), in (-180, 180]. */
function shortWayDeg(a: number, b: number): number {
  const d = ((((b - a) % 360) + 540) % 360) - 180;
  return d === -180 ? 180 : d;
}

/** `lng` in [-180, 180). */
function wrapLngDeg(lng: number): number {
  return ((((lng + 180) % 360) + 360) % 360) - 180;
}

function isPose(p: GlobeViewPose): boolean {
  return [p.lat, p.lng, p.altitudeKm, p.headingDeg, p.pitchDeg].every(
    Number.isFinite,
  );
}

function check(goal: GlobeViewPose, groundM: number, durationMs: number): void {
  if (!isPose(goal) || !Number.isFinite(groundM)) {
    throw new RangeError("an approach needs a finite goal and ground height");
  }
  if (!(durationMs > 0 && Number.isFinite(durationMs))) {
    throw new RangeError(
      `an approach's duration must be a positive number, got ${String(durationMs)}`,
    );
  }
}

/**
 * The approach to `goal` (its ground `groundM` over the ellipsoid) from
 * high above: `startHeightKm` over the ground, offset west and south,
 * looking straight down, north up. `reducedMotion` takes the short
 * flight; `durationMs` sets the length outright (the page's checks).
 * RangeError for a goal or ground that is not finite, or a length that is
 * not a positive number.
 */
export function approachFlight(
  goal: GlobeViewPose,
  groundM: number,
  options: {
    readonly reducedMotion?: boolean;
    readonly durationMs?: number;
  } = {},
): ApproachFlight {
  const durationMs =
    options.durationMs ??
    (options.reducedMotion
      ? GLOBE_APPROACH.reducedDurationMs
      : GLOBE_APPROACH.durationMs);
  check(goal, groundM, durationMs);
  const { startHeightKm, startOffsetLatDeg, startOffsetLngDeg } =
    GLOBE_APPROACH;
  const lat = Math.max(-80, Math.min(80, goal.lat - startOffsetLatDeg));
  const from: GlobeViewPose = {
    lat,
    lng: wrapLngDeg(goal.lng - startOffsetLngDeg),
    altitudeKm: groundM / 1000 + startHeightKm,
    headingDeg: 0,
    pitchDeg: -90,
  };
  return {
    from,
    to: goal,
    groundM,
    durationMs,
    pitchShare: GLOBE_APPROACH.pitchShare,
    barFromM: startHeightKm * 1000,
  };
}

/**
 * The flight from `now` (where the camera is, `elapsedMs` into `flight`)
 * to a new `goal`: it takes what is left of the flight, `retargetMinMs`
 * at least, turns its pitch evenly from now's, and keeps the bar's scale.
 */
export function retargetFlight(
  flight: ApproachFlight,
  now: GlobeViewPose,
  elapsedMs: number,
  goal: GlobeViewPose,
  groundM: number,
): ApproachFlight {
  const left = flight.durationMs - Math.max(0, elapsedMs);
  const durationMs = Math.max(GLOBE_APPROACH.retargetMinMs, left);
  check(goal, groundM, durationMs);
  if (!isPose(now)) throw new RangeError("a retarget needs a finite pose");
  return {
    from: now,
    to: goal,
    groundM,
    durationMs,
    pitchShare: 0,
    barFromM: Math.max(flight.barFromM, heightOver(now, groundM)),
  };
}

/** Whether `flight` has ended `elapsedMs` after it began. */
export function flightDone(flight: ApproachFlight, elapsedMs: number): boolean {
  return elapsedMs >= flight.durationMs;
}

/**
 * The camera's pose `elapsedMs` into `flight`. The ends are exact and held
 * outside [0, durationMs]; a time that is not a number reads as the end.
 */
export function flightPoseAt(
  flight: ApproachFlight,
  elapsedMs: number,
): GlobeViewPose {
  const t = Number.isNaN(elapsedMs)
    ? 1
    : Math.min(1, Math.max(0, elapsedMs / flight.durationMs));
  if (t >= 1) return flight.to;
  const { from, to, groundM, pitchShare } = flight;
  const turn = smoothstep01(t / GLOBE_APPROACH.turnShare);
  const fromH = heightOver(from, groundM);
  const toH = heightOver(to, groundM);
  const heightM = fromH * (toH / fromH) ** smoothstep01(t);
  const tip = smoothstep01((t - pitchShare) / (1 - pitchShare));
  const heading =
    from.headingDeg + shortWayDeg(from.headingDeg, to.headingDeg) * turn;
  return {
    lat: from.lat + (to.lat - from.lat) * turn,
    lng: wrapLngDeg(from.lng + shortWayDeg(from.lng, to.lng) * turn),
    altitudeKm: (groundM + heightM) / 1000,
    headingDeg: ((heading % 360) + 360) % 360,
    pitchDeg: from.pitchDeg + (to.pitchDeg - from.pitchDeg) * tip,
  };
}

/**
 * The bar's value (0 to 1) for a camera at `altitudeKm` during `flight`:
 * how far its height over the ground has fallen from the bar's first
 * height to the goal's, on a log scale. Clamped; a height that is not a
 * number reads as 0.
 */
export function barValue(flight: ApproachFlight, altitudeKm: number): number {
  if (!Number.isFinite(altitudeKm)) return 0;
  const toH = heightOver(flight.to, flight.groundM);
  const fromH = Math.max(flight.barFromM, toH * 1.0001);
  const h = Math.max(0.01, altitudeKm * 1000 - flight.groundM);
  const k = 1 - Math.log(h / toH) / Math.log(fromH / toH);
  return Math.min(1, Math.max(0, k));
}
