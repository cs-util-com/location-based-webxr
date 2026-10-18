/**
 * The clouds' drift by the camera's altitude (round-5 plan
 * 2026-10-12-0612 §9, DEC-R5-3). The owner on r826: one rate felt too slow
 * while the whole Earth was in view and far too fast near the volumetric
 * clouds. Seen straight down from the altitude h, a ground speed v moves on
 * the screen at v / h radians a second, so one rate looks 4,000 times
 * faster at 10 km than at 40,000 km. Here the ground speed is proportional
 * to the altitude below `farM` (the same apparent speed at every height),
 * the far rate above it, and never below a calm wind.
 *
 * The surface, the shell and the slab read one longitude offset; with a
 * rate that changes with the altitude it is summed per frame
 * (`advanceCloudLonOffsetRad`), never re-derived as rate x time, which
 * would jump the clouds at every change of height.
 *
 * @see globe-cloud-drift.ts.md
 */

import { GLOBE_CLOUD_DRIFT_DEG_PER_S } from "./globe-surface-material.js";

export const GLOBE_CLOUD_DRIFT_LAW = {
  /** The far rate holds from this altitude up, m. */
  farM: 20_000_000,
  /** The slowest drift over the ground, m/s at the equator (a calm wind). */
  windMps: 10,
  /** The radius that turns degrees into metres over the ground, m. */
  radiusM: 6_371_000,
  /**
   * One step never sums more than this much drift time, s: a stalled frame
   * or a hidden tab resumes about where it stopped. Above the slowest
   * frames (headless, about 0.7 s), so it never slows a running drift.
   */
  maxStepS: 1,
} as const;

/** The knobs: the far rate (degrees a second), its altitude and the wind. */
export interface CloudDriftOptions {
  readonly farDegPerS?: number;
  readonly farM?: number;
  readonly windMps?: number;
}

/**
 * The drift's rate at the camera's `altitudeM`, degrees of longitude a
 * second: `farDegPerS` from `farM` up, proportional to the altitude below,
 * never slower than `windMps` over the ground (nor faster than the far
 * rate). An altitude that is not a number reads as far out; a negative one
 * as the ground. RangeError for a far rate below 0, a `farM` that is not
 * positive or a wind below 0 (each finite).
 */
export function cloudDriftDegPerS(
  altitudeM: number,
  options: CloudDriftOptions = {},
): number {
  const farDegPerS = options.farDegPerS ?? GLOBE_CLOUD_DRIFT_DEG_PER_S;
  const farM = options.farM ?? GLOBE_CLOUD_DRIFT_LAW.farM;
  const windMps = options.windMps ?? GLOBE_CLOUD_DRIFT_LAW.windMps;
  requireAtLeast("the far rate", farDegPerS, 0);
  requireAtLeast("the wind", windMps, 0);
  if (!(farM > 0 && Number.isFinite(farM))) {
    throw new RangeError(`the far altitude must be positive, got ${farM}`);
  }
  if (farDegPerS === 0) return 0;
  if (Number.isNaN(altitudeM)) return farDegPerS;
  const farMps = (farDegPerS * Math.PI * GLOBE_CLOUD_DRIFT_LAW.radiusM) / 180;
  const share = Math.min(1, Math.max(altitudeM / farM, windMps / farMps));
  return farDegPerS * share;
}

/**
 * The offset `offsetRad` moved east by `degPerS` over `dtS` seconds,
 * wrapped into [0, 2π). A step is capped at `maxStepS` (a stalled frame, a
 * hidden tab); one that is not forward or not a number moves
 * nothing. RangeError for an offset or a rate that is not finite.
 */
export function advanceCloudLonOffsetRad(
  offsetRad: number,
  dtS: number,
  degPerS: number,
): number {
  if (!Number.isFinite(offsetRad) || !Number.isFinite(degPerS)) {
    throw new RangeError(
      `the drift needs a finite offset and rate, got ${offsetRad}, ${degPerS}`,
    );
  }
  if (!(dtS > 0)) return offsetRad;
  const step = Math.min(dtS, GLOBE_CLOUD_DRIFT_LAW.maxStepS);
  const turn = 2 * Math.PI;
  const next = (offsetRad + (degPerS * step * Math.PI) / 180) % turn;
  const wrapped = next < 0 ? next + turn : next;
  // A tiny negative remainder can round up to exactly a turn.
  return wrapped >= turn ? 0 : wrapped;
}

/** RangeError unless `value` is finite and at least `min`. */
function requireAtLeast(name: string, value: number, min: number): void {
  if (!(value >= min && Number.isFinite(value))) {
    throw new RangeError(`${name} must be at least ${min}, got ${value}`);
  }
}
