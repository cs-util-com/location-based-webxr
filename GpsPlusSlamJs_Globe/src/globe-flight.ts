/**
 * The oblique flight's laws (round-5 plan 2026-10-01-0945 §3.5; one-scene
 * plan 2026-09-28-2140 §3.3-§3.4; F1): the view's depression by altitude,
 * the relief's exaggeration by altitude, the clearance over the
 * exaggerated ground, and the frame metric the plan sweeps. Pure.
 *
 * @see globe-flight.ts.md
 */
import { smoothstep } from "./globe-camera.js";

export const GLOBE_FLIGHT = Object.freeze({
  /** Above this the view looks at the Earth's centre (pitch 90 degrees). */
  pitchHighM: 5_000_000,
  /** By this the pitch has eased to `pitchLowDeg`. */
  pitchLowM: 1_000_000,
  /** The low pitch: the plan's default of its 30-60 degree sweep. */
  pitchLowDeg: 45,
  /** E is 1 above this (globe scale). */
  exaggerationFarM: 2_000_000,
  /** E is the near value at and below this. */
  exaggerationNearM: 20_000,
  /** The near-ground E: 3 (DEC-GL5-5). */
  exaggerationNear: 3,
  /** E moves in these steps, so the tile tree is not re-traversed each frame. */
  exaggerationStep: 0.1,
  /** The least height over the exaggerated ground. */
  clearanceM: 300,
  /** The Earth's mean radius for the frame metric. */
  radiusM: 6_371_000,
  /**
   * The band where the relief's tiles take over from the globe's own
   * surface (one-scene plan §3.2): the globe alone above `bandHighM`, the
   * relief alone at and below `bandLowM`, a dithered cross-fade between.
   * E leaves 1 (its first 0.1 step) near 1,300 km, inside the band, so the
   * relief is flat while the globe still draws.
   */
  bandHighM: 2_000_000,
  bandLowM: 1_200_000,
});

const DEG = Math.PI / 180;

/** How far `altM` lies from `far` down to `near`, 0-1, in the logarithm. */
const logShare = (altM: number, far: number, near: number): number =>
  (Math.log(far) - Math.log(Math.max(altM, 1))) /
  (Math.log(far) - Math.log(near));

/**
 * The view's depression below the local horizontal at an altitude (m):
 * 90 degrees (looking at the centre) above `pitchHighM`, `pitchLowDeg`
 * from `pitchLowM` down, smoothstep in the logarithm of the altitude
 * between. RangeError for a non-finite altitude or a low pitch outside
 * 0-90 degrees.
 */
export function pitchAtDeg(
  altM: number,
  options: { pitchLowDeg?: number } = {},
): number {
  const { pitchLowDeg = GLOBE_FLIGHT.pitchLowDeg } = options;
  if (!Number.isFinite(altM)) {
    throw new RangeError(`the altitude must be finite, got ${altM}`);
  }
  if (!(pitchLowDeg > 0 && pitchLowDeg <= 90)) {
    throw new RangeError(
      `the low pitch must be 0-90 degrees, got ${pitchLowDeg}`,
    );
  }
  const s = smoothstep(
    logShare(altM, GLOBE_FLIGHT.pitchHighM, GLOBE_FLIGHT.pitchLowM),
  );
  return 90 + (pitchLowDeg - 90) * s;
}

/**
 * The relief's exaggeration at an altitude (m): 1 above
 * `exaggerationFarM`, `near` (3) from `exaggerationNearM`
 * down, smoothstep in the logarithm between, rounded to
 * `exaggerationStep` so it changes in steps. Never falls as the camera
 * descends. RangeError for a negative or non-finite altitude or a near
 * value below 1.
 */
export function exaggerationAt(
  altM: number,
  options: { near?: number } = {},
): number {
  const { near = GLOBE_FLIGHT.exaggerationNear } = options;
  if (!(altM >= 0 && Number.isFinite(altM))) {
    throw new RangeError(`the altitude must be finite and >= 0, got ${altM}`);
  }
  if (!(near >= 1 && Number.isFinite(near))) {
    throw new RangeError(`the near exaggeration must be >= 1, got ${near}`);
  }
  const s = smoothstep(
    logShare(
      altM,
      GLOBE_FLIGHT.exaggerationFarM,
      GLOBE_FLIGHT.exaggerationNearM,
    ),
  );
  const step = GLOBE_FLIGHT.exaggerationStep;
  return Math.round((1 + (near - 1) * s) / step) * step;
}

/**
 * The least altitude the camera may have over ground of `groundM` (m above
 * the ellipsoid) drawn at exaggeration `e`: the exaggerated ground (the sea
 * at 0) plus `clearanceM` (one-scene plan §3.4). RangeError for an
 * exaggeration below 1 or a negative clearance.
 */
export function minimumAltitudeM(
  groundM: number,
  e: number,
  clearanceM: number,
): number {
  if (!(e >= 1 && Number.isFinite(e))) {
    throw new RangeError(`the exaggeration must be >= 1, got ${e}`);
  }
  if (!(clearanceM >= 0 && Number.isFinite(clearanceM))) {
    throw new RangeError(`the clearance must be >= 0, got ${clearanceM}`);
  }
  return Math.max(0, groundM) * e + clearanceM;
}

/**
 * The plan's frame metric for a camera looking at the target from
 * `altitudeM` with depression `pitchDeg` and vertical field of view
 * `fovYDeg`: the target sits at the view's centre (in the centre third by
 * construction), and the ground fills the top edge when the top ray's
 * depression exceeds the horizon's dip, acos(R / (R + h)).
 */
export function frameCheck(input: {
  altitudeM: number;
  pitchDeg: number;
  fovYDeg: number;
}): { targetInCentreThird: boolean; groundAtTop: boolean; dipDeg: number } {
  const { altitudeM, pitchDeg, fovYDeg } = input;
  const r = GLOBE_FLIGHT.radiusM;
  const dipDeg = Math.acos(r / (r + altitudeM)) / DEG;
  return {
    targetInCentreThird: true,
    groundAtTop: pitchDeg - fovYDeg / 2 > dipDeg,
    dipDeg,
  };
}

/**
 * The relief carrier's share of the pixels at an altitude (m): 0 at and
 * above `highM` (the globe's own surface draws alone), 1 at and below
 * `lowM` (the relief's tiles alone), smoothstep in the logarithm of the
 * altitude between; the globe's share is 1 minus it. Never falls as the
 * camera descends. RangeError for a non-finite altitude or edges that are
 * not 0 < lowM < highM.
 */
export function carrierShareAt(
  altM: number,
  options: { highM?: number; lowM?: number } = {},
): number {
  const { highM = GLOBE_FLIGHT.bandHighM, lowM = GLOBE_FLIGHT.bandLowM } =
    options;
  if (!Number.isFinite(altM)) {
    throw new RangeError(`the altitude must be finite, got ${altM}`);
  }
  if (!(lowM > 0 && lowM < highM && Number.isFinite(highM))) {
    throw new RangeError(
      `the band needs 0 < low < high, got ${lowM} and ${highM}`,
    );
  }
  if (altM >= highM) return 0;
  if (altM <= lowM) return 1;
  return smoothstep(logShare(altM, highM, lowM));
}
