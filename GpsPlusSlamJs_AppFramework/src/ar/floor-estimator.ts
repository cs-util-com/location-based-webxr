/**
 * AR Floor Estimator
 *
 * Pure column-histogram + least-squares-plane floor estimator over the
 * sparse {@link OccupancyGrid}, entirely in the RAW WebXR (local-floor)
 * frame — the same frame the grid, `getCellPoint`, and the cube
 * visualizer's `ViewerPose` use. No THREE, no DOM, no Redux; callers feed
 * it the grid and a camera position each tick and gate on the returned
 * confidence.
 *
 * Algorithm (corpus-validated shape): occupied cells within the query
 * radius that sit at least `minBelowCameraM` below the camera are bucketed
 * by integer cell-y; the LOWEST band `bandCells` tall with at least
 * `minSupportCells` support wins. Per-cell heights come from
 * `getCellPoint` (sub-cell running-average surface points; cell-center
 * fallback), and a least-squares plane `y = a + b·x + c·z` is fitted over
 * the band's points so the floor height is evaluated at the camera's OWN
 * XZ instead of the band mean — on a slope, the difference is the whole
 * point.
 *
 * The default constants are corpus-measured for THIS production module
 * (floor-estimator-production-crossval, 90 usable deduped real recordings
 * on the intended 0.16 m / ≥2-observation grid): an estimate lands on ~every 1 Hz
 * tick, the median per-recording ACCEPT RATE — the share of a recording's
 * estimates whose camera height falls inside [0.5, 2.5] m — is 0.90, and
 * the median over per-recording MEDIAN camera heights is 1.67 m. The
 * plausibility band below is that measured envelope, not a guess. (The
 * spike prototype measured 0.95 / 1.72 m with its band-MEAN height; the
 * plane fit evaluated at the camera's XZ shifts both statistics slightly.)
 *
 * @see floor-estimator.ts.md for detailed documentation
 */

import type { GridCell } from './bresenham3d';
import {
  type OccupancyGrid,
  DEFAULT_OCCUPANCY_MIN_OBSERVATIONS,
} from './occupancy-grid';

/** Query radius around the camera, metres (corpus-validated default). */
export const DEFAULT_FLOOR_QUERY_RADIUS_M = 3;
/**
 * Cells closer than this below the camera are never floor candidates —
 * excludes the user's own hands/device and table edges hugging the camera.
 */
export const DEFAULT_FLOOR_MIN_BELOW_CAMERA_M = 0.4;
/** Minimum cells in a band before it can win (corpus-validated default). */
export const DEFAULT_FLOOR_MIN_SUPPORT_CELLS = 6;
/** Height of a candidate band in cell-y layers (corpus-validated default). */
export const DEFAULT_FLOOR_BAND_CELLS = 2;

/**
 * Plausible camera-height-above-floor envelope, metres. Corpus-measured
 * envelope: the median per-recording share of production estimates inside
 * it is 0.90 (production cross-validation, 90 usable deduped recordings).
 * OUTSIDE
 * the band an estimate is still returned — the estimator reports, callers
 * gate — but its confidence is scaled down hard (see {@link estimateFloor}).
 */
export const PLAUSIBLE_HEIGHT_MIN_M = 0.5;
export const PLAUSIBLE_HEIGHT_MAX_M = 2.5;

/** Support count at which the support confidence term saturates at 1. */
const SUPPORT_SATURATION_CELLS = 20;
/** Plane-fit RMS residual granted full confidence credit (≈ half a cell). */
const RESIDUAL_FULL_CREDIT_M = 0.08;
/** e-folding scale of the confidence decay beyond the residual credit. */
const RESIDUAL_DECAY_SCALE_M = 0.08;
/** e-folding scale of the confidence decay outside the plausibility band. */
const PLAUSIBILITY_DECAY_SCALE_M = 0.15;
/** Relative determinant floor below which the plane fit is degenerate. */
const DEGENERACY_EPS = 1e-9;
/**
 * Confidence multiplier when the extrapolation clamp fires. A clamped
 * estimate means the plane had to be extrapolated from one-sided steep
 * support INTO the exclusion zone at the camera's XZ — the least
 * trustworthy geometry the estimator can report — so the crush is
 * deliberate and hard: the plausibility decay alone (the clamped height is
 * `minBelowCameraM`, only 0.1 m below the band) would leave ~0.5.
 */
const CLAMPED_CONFIDENCE_FACTOR = 0.2;

export interface FloorEstimatorOptions {
  /** Query radius around the camera, metres. Default 3. */
  readonly queryRadiusM?: number;
  /** Exclusion distance below the camera, metres. Default 0.4. */
  readonly minBelowCameraM?: number;
  /** Minimum cells in the winning band. Default 6. */
  readonly minSupportCells?: number;
  /** Band height in cell-y layers. Default 2. */
  readonly bandCells?: number;
  /**
   * Minimum per-cell observation count for a cell to participate.
   * Default {@link DEFAULT_OCCUPANCY_MIN_OBSERVATIONS} (2) — the framework
   * noise floor the corpus was measured on.
   */
  readonly minObservations?: number;
}

/**
 * Measured surface point of one supporting cell, raw AR (WebXR) frame —
 * the band members behind an estimate, exposed for downstream per-hit
 * sampling (e.g. pairing each hit with a terrain height at its XZ).
 */
export interface FloorHit {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface FloorEstimate {
  /** Plane-fit floor height at the camera's XZ, raw AR frame. */
  readonly floorYar: number;
  /** `cameraY − floorYar`. */
  readonly heightAboveFloorM: number;
  /** Plane gradient dy/dx of the fitted floor plane. */
  readonly slopeX: number;
  /** Plane gradient dy/dz of the fitted floor plane. */
  readonly slopeZ: number;
  /** 0..1 gate signal — see the confidence model in the sidecar. */
  readonly confidence: number;
  /**
   * True when `floorYar` was clamped to the exclusion line because the
   * plane, evaluated at the camera's XZ, extrapolated above it (one-sided
   * steep support). A clamped estimate's confidence is additionally
   * multiplied by {@link CLAMPED_CONFIDENCE_FACTOR}.
   */
  readonly clamped: boolean;
  /** Number of cells in the winning band. */
  readonly support: number;
  /** RMS residual of the plane fit over the band's points, metres. */
  readonly planeResidualM: number;
  /** The band's measured points (one per supporting cell), raw AR frame. */
  readonly hits: readonly FloorHit[];
}

/**
 * Estimate the floor under `cameraPos` from the occupancy grid.
 *
 * Returns `null` when no estimate exists: empty/too-sparse grid, no band
 * with enough support, or every candidate cell above the exclusion line. A
 * non-finite `cameraPos` (tracking glitch) also answers `null`, mirroring
 * the grid's own non-finite policy. Invalid OPTIONS throw `RangeError` —
 * a malformed configuration is an upstream bug, not a data condition.
 *
 * An implausible estimate (height outside [0.5, 2.5] m) is RETURNED with
 * confidence scaled down hard, never hidden: the estimator reports,
 * callers gate. Likewise a clamped extrapolation (see `FloorEstimate.
 * clamped`) is returned with its confidence crushed by
 * {@link CLAMPED_CONFIDENCE_FACTOR}, never suppressed.
 */
export function estimateFloor(
  grid: OccupancyGrid,
  cameraPos: readonly [number, number, number],
  options?: FloorEstimatorOptions
): FloorEstimate | null {
  const opts = resolveOptions(options);
  if (!isFiniteTriple(cameraPos)) {
    return null;
  }
  const cells = grid.getOccupiedCellsWithin(
    cameraPos,
    opts.queryRadiusM,
    opts.minObservations
  );
  if (cells.length === 0) {
    return null;
  }
  const maxFloorY = cameraPos[1] - opts.minBelowCameraM;
  const band = selectLowestSupportedBand(
    cells,
    grid.cellSizeM,
    maxFloorY,
    opts.bandCells,
    opts.minSupportCells
  );
  if (!band) {
    return null;
  }
  const hits = collectHits(grid, band);
  const fit = fitPlane(hits);

  let floorYar = fit.a + fit.b * cameraPos[0] + fit.c * cameraPos[2];
  // Extrapolation guard: every candidate cell sits below the exclusion
  // line, but the plane EVALUATED at the camera's XZ can extrapolate above
  // it when the support is one-sided and steep. A floor inside the band the
  // histogram was told to ignore would contradict the input contract, so
  // clamp to the line (this is the one case where `floorYar` is not exactly
  // `a + b·x + c·z`). The clamp is reported via `clamped` and hard-crushes
  // the confidence below — the sub-plausible height alone would not.
  let clamped = false;
  if (floorYar > maxFloorY) {
    floorYar = maxFloorY;
    clamped = true;
  }
  const heightAboveFloorM = cameraPos[1] - floorYar;

  // Confidence terms (each in [0, 1], multiplied — see the sidecar):
  // support saturation, residual penalty, height plausibility, and the
  // extrapolation-clamp crush.
  const supportTerm = Math.min(1, hits.length / SUPPORT_SATURATION_CELLS);
  const residualExcess = Math.max(0, fit.residualM - RESIDUAL_FULL_CREDIT_M);
  const residualTerm = Math.exp(-residualExcess / RESIDUAL_DECAY_SCALE_M);
  const outsideM =
    heightAboveFloorM < PLAUSIBLE_HEIGHT_MIN_M
      ? PLAUSIBLE_HEIGHT_MIN_M - heightAboveFloorM
      : heightAboveFloorM > PLAUSIBLE_HEIGHT_MAX_M
        ? heightAboveFloorM - PLAUSIBLE_HEIGHT_MAX_M
        : 0;
  const plausibilityTerm = Math.exp(-outsideM / PLAUSIBILITY_DECAY_SCALE_M);
  const clampTerm = clamped ? CLAMPED_CONFIDENCE_FACTOR : 1;
  const confidence = Math.min(
    1,
    Math.max(0, supportTerm * residualTerm * plausibilityTerm * clampTerm)
  );

  return {
    floorYar,
    heightAboveFloorM,
    slopeX: fit.b,
    slopeZ: fit.c,
    confidence,
    clamped,
    support: hits.length,
    planeResidualM: fit.residualM,
    hits,
  };
}

interface ResolvedOptions {
  readonly queryRadiusM: number;
  readonly minBelowCameraM: number;
  readonly minSupportCells: number;
  readonly bandCells: number;
  readonly minObservations: number;
}

/** Boundary validation: malformed options are upstream bugs → RangeError. */
function resolveOptions(options: FloorEstimatorOptions = {}): ResolvedOptions {
  const {
    queryRadiusM = DEFAULT_FLOOR_QUERY_RADIUS_M,
    minBelowCameraM = DEFAULT_FLOOR_MIN_BELOW_CAMERA_M,
    minSupportCells = DEFAULT_FLOOR_MIN_SUPPORT_CELLS,
    bandCells = DEFAULT_FLOOR_BAND_CELLS,
    minObservations = DEFAULT_OCCUPANCY_MIN_OBSERVATIONS,
  } = options;
  requireFiniteAbove('queryRadiusM', queryRadiusM, 0);
  requireFiniteAtLeast('minBelowCameraM', minBelowCameraM, 0);
  requirePositiveInteger('minSupportCells', minSupportCells);
  requirePositiveInteger('bandCells', bandCells);
  requirePositiveInteger('minObservations', minObservations);
  return {
    queryRadiusM,
    minBelowCameraM,
    minSupportCells,
    bandCells,
    minObservations,
  };
}

function requireFiniteAbove(
  name: string,
  v: number,
  exclusiveMin: number
): void {
  if (!Number.isFinite(v) || v <= exclusiveMin) {
    throw new RangeError(
      `${name} must be a finite number > ${exclusiveMin}, got ${v}`
    );
  }
}

function requireFiniteAtLeast(name: string, v: number, min: number): void {
  if (!Number.isFinite(v) || v < min) {
    throw new RangeError(`${name} must be a finite number >= ${min}, got ${v}`);
  }
}

function requirePositiveInteger(name: string, v: number): void {
  if (!Number.isSafeInteger(v) || v < 1) {
    throw new RangeError(`${name} must be a positive integer, got ${v}`);
  }
}

/**
 * Column histogram: bucket the candidate cells (center at or below
 * `maxFloorY`) by integer cell-y, then scan bands bottom-up — the LOWEST
 * `bandCells`-tall band with at least `minSupportCells` members wins. The
 * lowest-first scan is what makes an elevated surface (table, ledge) lose
 * to the true floor whenever the floor has enough support.
 */
function selectLowestSupportedBand(
  cells: readonly GridCell[],
  cellSizeM: number,
  maxFloorY: number,
  bandCells: number,
  minSupportCells: number
): GridCell[] | null {
  const buckets = new Map<number, GridCell[]>();
  for (const cell of cells) {
    if (cell[1] * cellSizeM > maxFloorY) {
      continue;
    }
    const bucket = buckets.get(cell[1]);
    if (bucket) {
      bucket.push(cell);
    } else {
      buckets.set(cell[1], [cell]);
    }
  }
  if (buckets.size === 0) {
    return null;
  }
  const ys = [...buckets.keys()].sort((a, b) => a - b);
  for (const y0 of ys) {
    const band: GridCell[] = [];
    for (let dy = 0; dy < bandCells; dy++) {
      const bucket = buckets.get(y0 + dy);
      if (bucket) {
        band.push(...bucket);
      }
    }
    if (band.length >= minSupportCells) {
      return band;
    }
  }
  return null;
}

/**
 * One measured point per supporting cell: the sub-cell running-average
 * surface point where the grid has one (always, for an occupied cell), the
 * geometric cell center as the defensive fallback.
 */
function collectHits(
  grid: OccupancyGrid,
  band: readonly GridCell[]
): FloorHit[] {
  const hits: FloorHit[] = [];
  for (const cell of band) {
    const p = grid.getCellPoint(cell) ?? grid.getCellCenter(cell);
    hits.push({ x: p[0], y: p[1], z: p[2] });
  }
  return hits;
}

interface PlaneFit {
  /** Intercept of `y = a + b·x + c·z`. */
  readonly a: number;
  readonly b: number;
  readonly c: number;
  /** RMS residual of the fit over the input points, metres. */
  readonly residualM: number;
}

/**
 * Least-squares plane `y = a + b·x + c·z` over the hits, solved on
 * CENTERED coordinates (2×2 covariance system) for conditioning. Degenerate
 * support — fewer than 3 points, or an XZ footprint that is collinear /
 * a single spot (relative determinant below {@link DEGENERACY_EPS}) —
 * falls back to the mean height with zero slopes: a safe horizontal answer
 * instead of an exploding gradient.
 */
function fitPlane(hits: readonly FloorHit[]): PlaneFit {
  const n = hits.length;
  let mx = 0;
  let my = 0;
  let mz = 0;
  for (const h of hits) {
    mx += h.x;
    my += h.y;
    mz += h.z;
  }
  mx /= n;
  my /= n;
  mz /= n;

  let sxx = 0;
  let sxz = 0;
  let szz = 0;
  let sxy = 0;
  let szy = 0;
  for (const h of hits) {
    const dx = h.x - mx;
    const dy = h.y - my;
    const dz = h.z - mz;
    sxx += dx * dx;
    sxz += dx * dz;
    szz += dz * dz;
    sxy += dx * dy;
    szy += dz * dy;
  }
  const det = sxx * szz - sxz * sxz;
  let b = 0;
  let c = 0;
  if (n >= 3 && det > DEGENERACY_EPS * Math.max(sxx * szz, DEGENERACY_EPS)) {
    b = (sxy * szz - szy * sxz) / det;
    c = (szy * sxx - sxy * sxz) / det;
  }
  const a = my - b * mx - c * mz;

  let sumSq = 0;
  for (const h of hits) {
    const r = h.y - (a + b * h.x + c * h.z);
    sumSq += r * r;
  }
  return { a, b, c, residualM: Math.sqrt(sumSq / n) };
}

function isFiniteTriple(v: readonly [number, number, number]): boolean {
  return (
    Number.isFinite(v[0]) && Number.isFinite(v[1]) && Number.isFinite(v[2])
  );
}
