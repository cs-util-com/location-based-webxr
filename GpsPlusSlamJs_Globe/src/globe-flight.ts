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
  /**
   * The near-ground E: 1, true heights at every altitude (the owner's D-K1,
   * city plan 2026-10-05-0040 §11: the city's buildings stand on the real
   * ground). It was 3 (DEC-GL5-5); the law and its `near` option stay, so
   * a link can still ask for the exaggerated relief.
   */
  exaggerationNear: 1,
  /** E moves in these steps, so the tile tree is not re-traversed each frame. */
  exaggerationStep: 0.1,
  /**
   * The third band (city plan 2026-10-05-0040 K1), only with a `ground`
   * value: E is the near value at and above this...
   */
  groundBandTopM: 8_000,
  /** ...and the ground value at and below this, smoothstep in the log between. */
  groundBandBottomM: 2_000,
  /** The least height over the exaggerated ground. */
  clearanceM: 300,
  /** The Earth's mean radius for the frame metric. */
  radiusM: 6_371_000,
  /**
   * The least the view looks below the horizon (degrees): the view's centre
   * is the target, so the law never looks past the horizon there (at a low
   * pitch of 30 it did, between about 985 and 1,300 km).
   */
  horizonMarginDeg: 5,
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

/** The horizon's dip below the local horizontal at an altitude (degrees). */
const horizonDipDeg = (altitudeM: number): number => {
  const r = GLOBE_FLIGHT.radiusM;
  return Math.acos(r / (r + Math.max(0, altitudeM))) / DEG;
};

/**
 * The view's depression below the local horizontal at an altitude (m):
 * 90 degrees (looking at the centre) above `pitchHighM`, `pitchLowDeg`
 * from `pitchLowM` down, smoothstep in the logarithm of the altitude
 * between; never less than `horizonMarginDeg` below the horizon, so the
 * target (the view's centre) stays in view. RangeError for a non-finite
 * altitude or a low pitch outside 0-90 degrees.
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
  const law = 90 + (pitchLowDeg - 90) * s;
  return Math.min(
    90,
    Math.max(law, horizonDipDeg(altM) + GLOBE_FLIGHT.horizonMarginDeg),
  );
}

/**
 * The relief's exaggeration at an altitude (m): 1 above
 * `exaggerationFarM`, `near` (3) from `exaggerationNearM`
 * down, smoothstep in the logarithm between, rounded to
 * `exaggerationStep` so it changes in steps. Never falls as the camera
 * descends - unless a `ground` value (1 to `near`) is given: then a third
 * band eases it from `near` at `groundBandTopM` to `ground` at
 * `groundBandBottomM` and below, so a city can stand on true heights
 * (K1). RangeError for a negative or non-finite altitude, a near value
 * below 1, or a ground value outside 1 to `near`.
 */
export function exaggerationAt(
  altM: number,
  options: { near?: number; ground?: number } = {},
): number {
  const { near = GLOBE_FLIGHT.exaggerationNear } = options;
  const ground = options.ground ?? near;
  if (!(altM >= 0 && Number.isFinite(altM))) {
    throw new RangeError(`the altitude must be finite and >= 0, got ${altM}`);
  }
  if (!(near >= 1 && Number.isFinite(near))) {
    throw new RangeError(`the near exaggeration must be >= 1, got ${near}`);
  }
  if (!(ground >= 1 && ground <= near)) {
    throw new RangeError(
      `the ground exaggeration must be 1 to the near value ${near}, got ${ground}`,
    );
  }
  const s = smoothstep(
    logShare(
      altM,
      GLOBE_FLIGHT.exaggerationFarM,
      GLOBE_FLIGHT.exaggerationNearM,
    ),
  );
  const g = smoothstep(
    logShare(altM, GLOBE_FLIGHT.groundBandTopM, GLOBE_FLIGHT.groundBandBottomM),
  );
  const step = GLOBE_FLIGHT.exaggerationStep;
  const e = 1 + (near - 1) * s + (ground - near) * g;
  return Math.round(e / step) * step;
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
 * `fovYDeg`, against the horizon's dip, acos(R / (R + h)):
 * `targetVisible` when the view's centre (the target) looks below the
 * horizon, `groundAtTop` when the top ray does too.
 */
export function frameCheck(input: {
  altitudeM: number;
  pitchDeg: number;
  fovYDeg: number;
}): { targetVisible: boolean; groundAtTop: boolean; dipDeg: number } {
  const { altitudeM, pitchDeg, fovYDeg } = input;
  const dipDeg = horizonDipDeg(altitudeM);
  return {
    targetVisible: pitchDeg > dipDeg,
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

/**
 * The camera's altitude (m) raised, if need be, to the clearance over the
 * DRAWN ground under it: `displacedGroundM` is the relief's height there as
 * drawn (already exaggerated; the sea at 0), null where no relief is
 * loaded, which leaves the altitude alone. Applied every frame (one-scene
 * plan §3.4). RangeError for a non-finite altitude or ground, or a negative
 * clearance.
 */
export function clearedAltitudeM(
  altitudeM: number,
  displacedGroundM: number | null,
  clearanceM: number,
): number {
  if (!Number.isFinite(altitudeM)) {
    throw new RangeError(`the altitude must be finite, got ${altitudeM}`);
  }
  if (displacedGroundM !== null && !Number.isFinite(displacedGroundM)) {
    throw new RangeError(
      `the ground must be finite or null, got ${displacedGroundM}`,
    );
  }
  if (!(clearanceM >= 0 && Number.isFinite(clearanceM))) {
    throw new RangeError(`the clearance must be >= 0, got ${clearanceM}`);
  }
  if (displacedGroundM === null) return altitudeM;
  return Math.max(altitudeM, Math.max(0, displacedGroundM) + clearanceM);
}

/**
 * The city's share of its fade at `altM` (globe city plan 2026-10-05-0040
 * §12.5 C4): 0 at and above `topM`, 1 at and below two thirds of it,
 * smoothstep between. RangeError for a non-finite altitude or a `topM` that
 * is not positive.
 */
export function cityShareAt(altM: number, topM: number): number {
  if (!Number.isFinite(altM)) {
    throw new RangeError(`the altitude must be finite, got ${altM}`);
  }
  if (!(topM > 0 && Number.isFinite(topM))) {
    throw new RangeError(`the city's top must be positive, got ${topM}`);
  }
  const bottomM = (topM * 2) / 3;
  const x = Math.min(1, Math.max(0, (topM - altM) / (topM - bottomM)));
  return smoothstep(x);
}
