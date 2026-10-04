/**
 * The cloud COLUMN: how thick the cloud layer is above a point of the noise,
 * and how much of a straight line of light it lets through (round-3 plan
 * 2026-09-27-0532, stream D; DEC-FB3-6 and -7).
 *
 * The slab (`cloud-slab.ts`) marches this column along the view; every other
 * straight line toward the sun reads it ONCE: the sun disc seen through the
 * clouds (the sky shader) and the sun light reaching a lit surface (the
 * cloud shadow patch, `cloud-shadow.ts`). One model, so the disc, the
 * shadows on the ground and the slab agree on where the cloud is thick.
 *
 * WHY A MODULE OF ITS OWN: it is a leaf (it imports no shader), so the sky's
 * GLSL (`atmosphere-glsl.ts`) can use it; the slab's module imports the sky's
 * GLSL and could not be imported back without a cycle.
 *
 * @see cloud-column.ts.md
 */

import { glslFloat } from '../../utils/glsl-float.js';
import { smoothstep } from '../../utils/smoothstep.js';
import { CLOUD_LAYER, cloudHorizonFade } from './cloud-layer.js';

type Vec3 = readonly [number, number, number];

/** The column's geometry and optics, metres (the scene's unit). */
export const CLOUD_COLUMN = {
  /** 400 m thick, centred on the sheet's 2 km: the A/B compares thickness. */
  baseM: 1800,
  topM: 2200,
  /** σ: an in-cloud visibility of 3.9/σ ≈ 195 m (stratocumulus: 100-300 m). */
  extinctionPerM: 0.02,
  /** b: the density ramps from 0 at the base to full over this height. */
  baseSoftM: 50,
  /**
   * H: metres of column thickness per unit of noise above the threshold.
   * 0.5·σ·H = 10 per noise unit matches the dome's density slope at the
   * threshold (≈ 9.4), so cloud edges seen from the ground are as sharp.
   */
  heightScaleM: 1000,
  /** The sun's elevation sine is floored here, so a low sun never divides by 0. */
  sunMuFloor: 0.1,
} as const;

/** The layer's middle, where a straight line reads the column (2 km). */
const MID_M = (CLOUD_COLUMN.baseM + CLOUD_COLUMN.topM) / 2;
/** A line this close to level is taken at this slope, for its crossing only. */
const CROSSING_DIR_Y_FLOOR = 1e-3;

/**
 * Q(h): the integral of the density ramp p(x) = clamp(x/b, 0, 1) from 0 to
 * h, in metres of full density. x²/(2b) up to b, x - b/2 above. GLSL twins:
 * `atmSlabCumulative` (the slab) and `atmColumnCumulative` (this file).
 */
export function cloudSlabCumulativeM(
  h: number,
  b: number = CLOUD_COLUMN.baseSoftM
): number {
  if (h <= 0) return 0;
  if (b <= 0) return h;
  return h < b ? (h * h) / (2 * b) : h - b / 2;
}

/**
 * T0: the column thickness whose zenith optical depth is ln 2, i.e. whose
 * zenith opacity is exactly one half: Q⁻¹(ln 2 / σ). Defined for any ramp,
 * so no (σ, b) pair a sweep tries is invalid.
 */
export function cloudSlabThresholdThicknessM(
  sigma: number = CLOUD_COLUMN.extinctionPerM,
  b: number = CLOUD_COLUMN.baseSoftM
): number {
  const q = Math.LN2 / sigma;
  if (b <= 0) return q;
  return q < b / 2 ? Math.sqrt(2 * b * q) : q + b / 2;
}

const T0 = cloudSlabThresholdThicknessM();

/**
 * A column's thickness from its noise and the cover's threshold: T0 at the
 * threshold, rising with the noise, capped at the slab's top (the deck). An
 * infinite threshold (cover 0) gives no cloud. The slab's shader clamps it
 * after interpolating (`atmSlabRawThickness` is the part before the clamp).
 */
export function cloudSlabThicknessM(noise: number, threshold: number): number {
  if (!Number.isFinite(threshold)) return 0;
  const T = T0 + CLOUD_COLUMN.heightScaleM * (noise - threshold);
  return Math.min(Math.max(T, 0), CLOUD_COLUMN.topM - CLOUD_COLUMN.baseM);
}

/**
 * The optical depth of the column above height `heightM` (world y, metres)
 * along a straight line whose vertical component is `dirY` (of a unit
 * direction): σ·(Q(T) - Q(h))/max(dirY, floor), with h the height above the
 * base clamped to the column. So 0 above the column's top, the whole column
 * from below the base, and ln 2 straight up through a column at the
 * threshold. The slope is floored at `sunMuFloor`, as the slab's sun is.
 * The whole column is read at ONE point (the caller's): an approximation
 * for a slanted line, which crosses neighbouring columns too. GLSL twin:
 * `atmColumnOpticalDepth`.
 *
 * @throws RangeError for a non-finite noise, height or slope.
 */
export function cloudColumnOpticalDepth(
  noise: number,
  threshold: number,
  heightM: number,
  dirY: number
): number {
  if (![noise, heightM, dirY].every(Number.isFinite)) {
    throw new RangeError(
      `column optical depth needs a finite noise, height and slope, got ${noise}, ${heightM}, ${dirY}`
    );
  }
  const T = cloudSlabThicknessM(noise, threshold);
  const h = Math.min(Math.max(heightM - CLOUD_COLUMN.baseM, 0), T);
  return (
    (CLOUD_COLUMN.extinctionPerM *
      (cloudSlabCumulativeM(T) - cloudSlabCumulativeM(h))) /
    Math.max(dirY, CLOUD_COLUMN.sunMuFloor)
  );
}

/**
 * Metres along a straight line from height `heightM` with vertical
 * component `dirY` to the layer's middle (2 km); 0 from above the middle.
 * GLSL twin: `atmColumnDistance`.
 */
export function cloudColumnDistanceM(heightM: number, dirY: number): number {
  return Math.max(MID_M - heightM, 0) / Math.max(dirY, CROSSING_DIR_Y_FLOOR);
}

/**
 * Where a straight line from `point` (metres) along the unit direction `dir`
 * reads the column: its crossing of the layer's middle (2 km), in the noise
 * texture's coordinates (tiles, plus the drift `offset`). A point above the
 * middle reads its own column. GLSL twin: `atmColumnUv`.
 */
export function cloudColumnUv(
  point: Vec3,
  dir: Vec3,
  offset: readonly [number, number]
): [number, number] {
  const s = cloudColumnDistanceM(point[1], dir[1]);
  const tileM = CLOUD_LAYER.tileKm * 1000;
  return [
    (point[0] + dir[0] * s) / tileM + offset[0],
    (point[2] + dir[2] * s) / tileM + offset[1],
  ];
}

/**
 * How much of the cloud at a column's crossing the sky DRAWS, seen from the
 * viewer: the sheet's and the slab's far fade on the crossing's horizontal
 * distance from the viewer (`anchored`, world-anchored clouds), or the
 * dome's horizon fade on the line's slope (the camera-centred dome), times
 * the aerial melt over `aerialM` metres. Every straight line to the sun
 * weights its optical depth by this, so the disc, the cloud shadows and the
 * sun-light dimming never see a cloud the sky does not show (round-3 review:
 * at a 5° sun the crossing lies ~22 km out, past the 21 km far fade, and the
 * ground went dark under an empty sky). GLSL twin: `atmColumnDrawn`.
 */
export function cloudColumnDrawn(
  aerialM: number,
  horizontalM: number,
  dirY: number,
  anchored: boolean,
  farFadeM: readonly [number, number]
): number {
  const fade = anchored
    ? 1 - smoothstep(farFadeM[0], farFadeM[1], horizontalM)
    : cloudHorizonFade(dirY);
  return fade * Math.exp((-aerialM * 0.001) / CLOUD_LAYER.aerialKm);
}

/**
 * Where the sky's clouds are drawn, for a line toward the light: the viewer
 * (the camera), whether the clouds are world-anchored (the sheet and the
 * slab) or on the camera-centred dome, and the far fade's start and end.
 */
export interface CloudColumnView {
  readonly camera: Vec3;
  readonly anchored: boolean;
  readonly farFadeM: readonly [number, number];
}

/**
 * The share of a straight line of light from `point` along the unit
 * direction `dir` (toward the light) that passes the cloud layer:
 * e^(-optical depth) of the column read where the line crosses the layer's
 * middle, the depth weighted by how much of that cloud the sky draws for
 * `view` (`cloudColumnDrawn`; omitted: all of it). 1 for a light at or
 * below the horizon (it lights nothing through the layer) and for an
 * infinite threshold (a clear sky). `noiseAt(u, v)` is the two-octave noise
 * at texture coordinates (`cloudNoiseSample` on the CPU). The CPU twin of
 * the cloud shadow patch (`cloud-shadow.ts`).
 */
export function cloudColumnTransmittanceToward(
  point: Vec3,
  dir: Vec3,
  threshold: number,
  noiseAt: (u: number, v: number) => number,
  offset: readonly [number, number],
  view?: CloudColumnView
): number {
  if (!(dir[1] > 0) || !Number.isFinite(threshold)) return 1;
  const [u, v] = cloudColumnUv(point, dir, offset);
  const depth = cloudColumnOpticalDepth(
    noiseAt(u, v),
    threshold,
    point[1],
    dir[1]
  );
  if (view === undefined) return Math.exp(-depth);
  const s = cloudColumnDistanceM(point[1], dir[1]);
  const dx = point[0] + dir[0] * s - view.camera[0];
  const dy = point[1] + dir[1] * s - view.camera[1];
  const dz = point[2] + dir[2] * s - view.camera[2];
  const drawn = cloudColumnDrawn(
    Math.hypot(dx, dy, dz),
    Math.hypot(dx, dz),
    dir[1],
    view.anchored,
    view.farFadeM
  );
  return Math.exp(-depth * drawn);
}

/**
 * The column's GLSL: constants, `atmColumnCumulative`,
 * `atmColumnOpticalDepth`, `atmColumnDistance` (metres along a line to its
 * crossing of the middle), `atmColumnUv` and `atmColumnDrawn`. SELF-CONTAINED (no uniform,
 * no other chunk) and include-guarded, so the sky, the slab and three's own
 * lit materials (through the cloud shadow patch, next to the haze's chunk)
 * can all include it.
 */
export const CLOUD_COLUMN_GLSL = /* glsl */ `
#ifndef ATM_CLOUD_COLUMN_GLSL
#define ATM_CLOUD_COLUMN_GLSL
const float ATM_COLUMN_BASE = ${glslFloat(CLOUD_COLUMN.baseM)};
const float ATM_COLUMN_DECK = ${glslFloat(CLOUD_COLUMN.topM - CLOUD_COLUMN.baseM)};
const float ATM_COLUMN_MID = ${glslFloat(MID_M)};
const float ATM_COLUMN_SIGMA = ${glslFloat(CLOUD_COLUMN.extinctionPerM)};
const float ATM_COLUMN_SOFT = ${glslFloat(CLOUD_COLUMN.baseSoftM)};
const float ATM_COLUMN_HEIGHT_SCALE = ${glslFloat(CLOUD_COLUMN.heightScaleM)};
const float ATM_COLUMN_T0 = ${glslFloat(T0)};
const float ATM_COLUMN_MU_FLOOR = ${glslFloat(CLOUD_COLUMN.sunMuFloor)};
const float ATM_COLUMN_CROSSING_FLOOR = ${glslFloat(CROSSING_DIR_Y_FLOOR)};
const float ATM_COLUMN_TILE_M = ${glslFloat(CLOUD_LAYER.tileKm * 1000)};
const float ATM_COLUMN_AERIAL_KM = ${glslFloat(CLOUD_LAYER.aerialKm)};

// Twin of cloudSlabCumulativeM.
float atmColumnCumulative(float h) {
  if (h <= 0.0) return 0.0;
  if (ATM_COLUMN_SOFT <= 0.0) return h;
  return h < ATM_COLUMN_SOFT ? h * h / (2.0 * ATM_COLUMN_SOFT) : h - 0.5 * ATM_COLUMN_SOFT;
}

// Twin of cloudColumnOpticalDepth (the threshold is 2, above any noise, when
// clear: no column).
float atmColumnOpticalDepth(float noise, float threshold, float heightM, float dirY) {
  float T = clamp(ATM_COLUMN_T0 + ATM_COLUMN_HEIGHT_SCALE * (noise - threshold), 0.0, ATM_COLUMN_DECK);
  float h = clamp(heightM - ATM_COLUMN_BASE, 0.0, T);
  return ATM_COLUMN_SIGMA * (atmColumnCumulative(T) - atmColumnCumulative(h)) / max(dirY, ATM_COLUMN_MU_FLOOR);
}

// Twin of cloudColumnDistanceM: metres along a line to the layer's middle.
float atmColumnDistance(float heightM, float dirY) {
  return max(ATM_COLUMN_MID - heightM, 0.0) / max(dirY, ATM_COLUMN_CROSSING_FLOOR);
}

// Twin of cloudColumnUv: the crossing of the middle, in noise tiles.
vec2 atmColumnUv(vec3 pointM, vec3 dir, vec2 offset) {
  return (pointM.xz + dir.xz * atmColumnDistance(pointM.y, dir.y)) / ATM_COLUMN_TILE_M + offset;
}

// Twin of cloudColumnDrawn: how much of the cloud at a crossing the sky
// draws (anchored: the far fade on the horizontal distance; the dome: its
// horizon fade, the twin of cloudHorizonFade), times the aerial melt. The
// disc and the cloud shadows both weight their optical depth by it.
float atmColumnDrawn(float aerialM, float horizontalM, float dirY, float anchored, vec2 farFadeM) {
  float fade = anchored > 0.5
    ? 1.0 - smoothstep(farFadeM.x, farFadeM.y, horizontalM)
    : smoothstep(0.0, 1.0, clamp(dirY / 0.12, 0.0, 1.0));
  return fade * exp(-aerialM * 0.001 / ATM_COLUMN_AERIAL_KM);
}
#endif
`;
