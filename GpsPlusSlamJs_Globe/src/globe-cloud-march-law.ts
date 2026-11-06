/**
 * The near clouds' laws, pure: the march's settings at a quality, the
 * distance scale of a tier, the size of the cloud target and the share of
 * it a frame draws, how far the haze lets clouds be seen, the coverage law
 * and the life cycle's clock. Every limit becomes a uniform: the scale
 * changes each frame without a shader swap or a new target.
 *
 * @see globe-cloud-march-law.ts.md
 */
import { lerp, smoothstep } from "./globe-ease.js";
import type { GlobeQuality } from "./globe-quality.js";

type GlobeCloudQuality = GlobeQuality["clouds"];
type GlobeCloudLaw = GlobeCloudQuality["law"];

/** The layer the march crosses (km over the sea). */
export const CLOUD_MARCH_LAYER = Object.freeze({ baseKm: 1.1, topKm: 3.3 });

/**
 * Coverage from the map's grey, 0, 0.125 .. 1: `domes` multiplies the dome
 * field, `deck` is how far a closed deck has risen under the domes; both
 * measured so the rendered cover equals the grey. `deckLevel` and
 * `deckRelief`: the deck's coverage and the swing of its relief.
 */
export const CLOUD_COVER_LAW = Object.freeze({
  domes: Object.freeze([0, 0.446, 0.555, 0.712, 0.9, 0.9, 0.9, 0.9, 0.9]),
  deck: Object.freeze([0, 0, 0, 0, 0.34, 0.434, 0.496, 0.559, 1]),
  deckLevel: 0.85,
  deckRelief: 0.2,
});

/** The far reach: step growth and the steps it may add. */
export const CLOUD_FAR_MARCH = Object.freeze({
  growAfterKm: 5,
  growPerKm: 10,
  growMax: 4,
  extraShare: 0.42,
  extraStepsMax: 48,
});

/** The life cycle at speed 1 (s); `CLOUD_LIFE_SPEED` shortens it. */
export const CLOUD_LIFE_PERIOD_S = 900;

/** The library's default: a cycle of 30 s of real time. */
export const CLOUD_LIFE_SPEED = 30;

/** The distance from an altitude to the layer (km), 0 inside it. */
export function cloudDistanceKm(altitudeKm: number): number {
  const { baseKm, topKm } = CLOUD_MARCH_LAYER;
  if (altitudeKm > topKm) return altitudeKm - topKm;
  return altitudeKm < baseKm ? baseKm - altitudeKm : 0;
}

/** The march's limits at one quality. */
export interface CloudMarch {
  readonly maxSteps: number;
  readonly segments: number;
  readonly stepFactor: number;
  readonly stepOffsetKm: number;
  readonly minStepKm: number;
  readonly lightSteps: number;
  readonly scatterOctaves: number;
  /** The erosion's weight, 0..1. */
  readonly detail: number;
  /** The density shadow's weight near the camera, 0..1. */
  readonly shadowDetail: number;
}

/**
 * The march at quality `q` (0 the cheapest, 1 the finest). Counts and step
 * factors move geometrically, so equal steps of `q` are equal cost ratios.
 */
export function cloudMarchAt(q: number): CloudMarch {
  const g = (a: number, b: number) => a * Math.pow(b / a, q);
  return {
    maxSteps: g(24, 96),
    segments: g(14, 56),
    stepFactor: g(0.09, 0.025),
    stepOffsetKm: lerp(1.5, 1, q),
    minStepKm: g(0.07, 0.025),
    lightSteps: lerp(1, 5, q),
    scatterOctaves: lerp(2, 3, q),
    detail: smoothstep((q - 0.35) / 0.4),
    shadowDetail: smoothstep((q - 0.5) / 0.4),
  };
}

/** What a law says at one distance. */
interface CloudLawSetting {
  readonly march: number;
  readonly pixelsPerCss: number;
}

/**
 * The law at `distanceKm`: the ends held, smoothstep in log distance
 * between neighbours.
 *
 * @throws RangeError for a law without a station.
 */
export function cloudLawAt(
  law: GlobeCloudLaw,
  distanceKm: number,
): CloudLawSetting {
  const first = law[0];
  const last = law.at(-1);
  if (first === undefined || last === undefined) {
    throw new RangeError("the cloud law has no station");
  }
  if (distanceKm <= first.distanceKm) {
    return { march: first.march, pixelsPerCss: first.pixelsPerCss };
  }
  const ld = Math.log(distanceKm);
  for (let i = 0; i + 1 < law.length; i++) {
    const near = law[i];
    const far = law[i + 1];
    if (near === undefined || far === undefined) break;
    const a = Math.log(near.distanceKm);
    const b = Math.log(far.distanceKm);
    if (ld <= b) {
      const u = smoothstep((ld - a) / (b - a));
      return {
        march: lerp(near.march, far.march, u),
        pixelsPerCss: lerp(near.pixelsPerCss, far.pixelsPerCss, u),
      };
    }
  }
  return { march: last.march, pixelsPerCss: last.pixelsPerCss };
}

/**
 * The law's coarsest setting: the field's filter reads from it, never from
 * the setting in use, so the quality never changes the clouds' shape.
 */
export function cloudFilterReference(law: GlobeCloudLaw): CloudLawSetting {
  return {
    march: Math.min(...law.map((s) => s.march)),
    pixelsPerCss: Math.min(...law.map((s) => s.pixelsPerCss)),
  };
}

/** The target's size: the tier's largest, at most the canvas's. */
export function cloudTargetSize(
  cssWidth: number,
  cssHeight: number,
  pixelRatio: number,
  quality: Pick<GlobeCloudQuality, "maxPixelsPerCss">,
): { width: number; height: number } {
  const c = Math.min(quality.maxPixelsPerCss, pixelRatio);
  return {
    width: Math.max(1, Math.round(cssWidth * c)),
    height: Math.max(1, Math.round(cssHeight * c)),
  };
}

/** The view a frame's settings are made for. */
interface CloudViewInput {
  readonly cssWidth: number;
  readonly cssHeight: number;
  readonly pixelRatio: number;
  readonly altitudeKm: number;
  /** The step-down's share of the law's pixels, above 0, at most 1. */
  readonly pixelScale: number;
}

/** One frame's limits (`cloudViewSettings`). */
export interface CloudViewSettings {
  readonly march: CloudMarch;
  readonly width: number;
  readonly height: number;
  /** The share of the target the frame draws. */
  readonly uv: readonly [number, number];
  readonly canvasPixelsPerCloudPixel: number;
  /** Canvas pixels per cloud pixel of the filter's reference. */
  readonly filterPixels: number;
  /** segments, stepFactor, stepOffsetKm, minStepKm of the reference. */
  readonly filterStep: readonly [number, number, number, number];
}

/**
 * A frame's limits on a tier.
 *
 * @throws RangeError for a pixel scale outside (0, 1].
 */
export function cloudViewSettings(
  quality: GlobeCloudQuality,
  view: CloudViewInput,
): CloudViewSettings {
  const { cssWidth, cssHeight, pixelRatio, altitudeKm, pixelScale } = view;
  if (!(pixelScale > 0 && pixelScale <= 1)) {
    throw new RangeError(
      `the pixel scale must be in (0, 1], got ${pixelScale}`,
    );
  }
  const law = cloudLawAt(quality.law, cloudDistanceKm(altitudeKm));
  const c = Math.min(law.pixelsPerCss, quality.maxPixelsPerCss, pixelRatio);
  const target = cloudTargetSize(cssWidth, cssHeight, pixelRatio, quality);
  const fit = (css: number, most: number) =>
    Math.min(most, Math.max(1, Math.round(css * c * pixelScale)));
  const width = fit(cssWidth, target.width);
  const height = fit(cssHeight, target.height);
  const canvasWidth = cssWidth * pixelRatio;
  const reference = cloudFilterReference(quality.law);
  const f = cloudMarchAt(reference.march);
  return {
    march: cloudMarchAt(law.march),
    width,
    height,
    uv: [width / target.width, height / target.height],
    canvasPixelsPerCloudPixel: canvasWidth / width,
    filterPixels:
      canvasWidth /
      Math.max(1, cssWidth * Math.min(reference.pixelsPerCss, pixelRatio)),
    filterStep: [f.segments, f.stepFactor, f.stepOffsetKm, f.minStepKm],
  };
}

const EARTH_KM = 6371;
const AIR_EXTINCTION_G = 13.558e-3;
const HAZE_EXTINCTION = 0.025;
const AIR_SCALE_KM = 8;
const HAZE_SCALE_KM = 1.2;
const REACH_MAX_KM = 4000;

/** The light left after `s` km towards the sphere at `midKm`; null: none. */
function hazeTransmittance(h: number, midKm: number, s: number): number | null {
  const A = EARTH_KM + h;
  const se = ((EARTH_KM + midKm) ** 2 - A * A - s * s) / (2 * A * s);
  if (Math.abs(se) > 1) return null;
  let depth = 0;
  const N = 48;
  for (let i = 0; i < N; i++) {
    const u = ((i + 0.5) / N) * s;
    const alt = Math.sqrt(A * A + u * u + 2 * A * u * se) - EARTH_KM;
    depth +=
      ((AIR_EXTINCTION_G * Math.exp(-alt / AIR_SCALE_KM) +
        HAZE_EXTINCTION * Math.exp(-alt / HAZE_SCALE_KM)) *
        s) /
      N;
  }
  return Math.exp(-depth);
}

/**
 * How far from altitude `h` (km) the air lets `limit` of a cloud's light at
 * `midKm` through: the first distance past the limit in 10 % steps, then
 * bisection. At most 4,000 km.
 */
export function cloudHazeReachKm(
  h: number,
  midKm: number,
  limit: number,
): number {
  let lo = 1;
  let hi: number | null = null;
  for (let s = 1; s < REACH_MAX_KM; s *= 1.1) {
    const T = hazeTransmittance(h, midKm, s);
    if (T === null) continue;
    if (T < limit) {
      hi = s;
      break;
    }
    lo = s;
  }
  if (hi === null) return REACH_MAX_KM;
  let top: number = hi;
  for (let k = 0; k < 14; k++) {
    const m = 0.5 * (lo + top);
    const T = hazeTransmittance(h, midKm, m);
    if (T === null || T >= limit) lo = m;
    else top = m;
  }
  return 0.5 * (lo + top);
}

/**
 * The lift of the shell's cover around the near clouds' hand-over: the shell
 * draws less cover than the map's grey there, so without it the clouds would
 * thin out at the hand-over. `gain` holds up to `fullToKm` and is gone at
 * `oneAtKm`.
 */
export const CLOUD_SHELL_LIFT = Object.freeze({
  gain: 1.3,
  fullToKm: 70,
  oneAtKm: 200,
});

/** The shell's cover factor at `altitudeKm`; 1 for a broken height. */
export function cloudShellCoverLift(
  altitudeKm: number,
  { gain, fullToKm, oneAtKm } = CLOUD_SHELL_LIFT,
): number {
  if (Number.isNaN(altitudeKm)) return 1;
  return lerp(
    gain,
    1,
    smoothstep((altitudeKm - fullToKm) / (oneAtKm - fullToKm)),
  );
}

/**
 * The life cycle at `timeS` and `speed`: its phase in cycles and the rise
 * of the shape and erosion noise (km), wrapped to their tiles' periods.
 */
export function cloudLifeClock(
  timeS: number,
  speed: number,
): { phase: number; billow: readonly [number, number] } {
  const t = timeS * speed;
  const wrap = (v: number, period: number) => {
    const r = v % period;
    return r < 0 ? r + period : r;
  };
  return {
    phase: wrap(t / CLOUD_LIFE_PERIOD_S, 1),
    billow: [wrap(t * 0.003, 3.8), wrap(t * 0.006, 0.85)],
  };
}
