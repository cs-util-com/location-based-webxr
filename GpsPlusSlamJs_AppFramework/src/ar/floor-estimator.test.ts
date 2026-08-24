/**
 * Floor Estimator Tests.
 *
 * Why this test matters:
 * `estimateFloor` is the production column-histogram + plane-fit floor
 * estimator over the occupancy grid. These tests pin the algorithm's
 * contract end-to-end through the REAL fold pipeline (synthetic
 * DepthSamples → addSample → estimate), not by poking internals:
 * - a flat floor is recovered within centimetres with ~zero slopes and
 *   high confidence;
 * - a sloped floor's plane gradient is recovered and the height is
 *   evaluated at the camera's XZ (not the band mean);
 * - a small deep-noise cluster below the real floor either loses on the
 *   support threshold or, when it squeaks past it, is reported with
 *   crushed confidence (never hidden — callers gate on confidence);
 * - empty / all-above-camera grids answer null;
 * - the height-plausibility confidence term decays monotonically outside
 *   the [0.5, 2.5] m band;
 * - option validation is strict at the module boundary.
 */

import { describe, it, expect } from 'vitest';
import type { Vector3 } from 'gps-plus-slam-js';
import { OccupancyGrid } from './occupancy-grid';
import {
  LOOK_UP,
  makeWorldPointSample as makeSample,
  surfacePatch,
} from '../test-utils/synthetic-depth-samples';
import {
  estimateFloor,
  DEFAULT_FLOOR_QUERY_RADIUS_M,
  DEFAULT_FLOOR_MIN_BELOW_CAMERA_M,
  DEFAULT_FLOOR_MIN_SUPPORT_CELLS,
  DEFAULT_FLOOR_BAND_CELLS,
  PLAUSIBLE_HEIGHT_MIN_M,
  PLAUSIBLE_HEIGHT_MAX_M,
} from './floor-estimator';

describe('estimateFloor', () => {
  it('exports the corpus-validated defaults', () => {
    expect(DEFAULT_FLOOR_QUERY_RADIUS_M).toBe(3);
    expect(DEFAULT_FLOOR_MIN_BELOW_CAMERA_M).toBe(0.4);
    expect(DEFAULT_FLOOR_MIN_SUPPORT_CELLS).toBe(6);
    expect(DEFAULT_FLOOR_BAND_CELLS).toBe(2);
    expect(PLAUSIBLE_HEIGHT_MIN_M).toBe(0.5);
    expect(PLAUSIBLE_HEIGHT_MAX_M).toBe(2.5);
  });

  it('recovers a flat floor: height within a few cm, ~zero slopes, high confidence', () => {
    const grid = new OccupancyGrid();
    const camera: Vector3 = [0, 1.7, 0];
    const pts = surfacePatch(() => 0, 0.9, 0.15);
    // Two adds so every cell reaches the DEFAULT minObservations floor (2).
    grid.addSample(makeSample(camera, pts));
    grid.addSample(makeSample(camera, pts));

    const est = estimateFloor(grid, camera);
    expect(est).not.toBeNull();
    expect(Math.abs(est!.floorYar)).toBeLessThan(0.03);
    expect(est!.heightAboveFloorM).toBeCloseTo(1.7, 1);
    expect(Math.abs(est!.slopeX)).toBeLessThan(0.02);
    expect(Math.abs(est!.slopeZ)).toBeLessThan(0.02);
    expect(est!.planeResidualM).toBeLessThan(0.02);
    expect(est!.confidence).toBeGreaterThan(0.8);
    // A flat well-supported floor is never a clamped extrapolation.
    expect(est!.clamped).toBe(false);
    expect(est!.support).toBeGreaterThanOrEqual(
      DEFAULT_FLOOR_MIN_SUPPORT_CELLS
    );
    // hits are the winning band's measured points, one per supporting cell.
    expect(est!.hits.length).toBe(est!.support);
    for (const hit of est!.hits) {
      expect(Number.isFinite(hit.x)).toBe(true);
      expect(Number.isFinite(hit.y)).toBe(true);
      expect(Number.isFinite(hit.z)).toBe(true);
      expect(hit.y).toBeLessThanOrEqual(
        camera[1] - DEFAULT_FLOOR_MIN_BELOW_CAMERA_M + 0.15
      );
    }
  });

  it('recovers a 12° sloped floor: gradient reflected in slopeX, height at the camera XZ', () => {
    const slope = Math.tan((12 * Math.PI) / 180); // ≈ 0.2126
    const grid = new OccupancyGrid();
    const camera: Vector3 = [0, 1.6, 0];
    // Plane y = slope·x passes through y = 0 at the camera's XZ (x = 0).
    grid.addSample(
      makeSample(
        camera,
        surfacePatch((x) => slope * x, 0.9, 0.15)
      )
    );

    const est = estimateFloor(grid, camera, { minObservations: 1 });
    expect(est).not.toBeNull();
    // The winning band is the lowest strip of the slope; the plane fit through
    // that strip lies on the true plane, so the gradient and the height at the
    // camera's XZ (an extrapolation from the strip) are both recovered.
    expect(est!.slopeX).toBeCloseTo(slope, 1);
    expect(Math.abs(est!.slopeX - slope)).toBeLessThan(0.04);
    expect(Math.abs(est!.slopeZ)).toBeLessThan(0.03);
    expect(Math.abs(est!.floorYar)).toBeLessThan(0.05);
    expect(est!.heightAboveFloorM).toBeCloseTo(1.6, 1);
    expect(est!.planeResidualM).toBeLessThan(0.03);
    expect(est!.confidence).toBeGreaterThan(0.8);
  });

  it('a 5-cell noise cluster below the real floor loses on the support threshold', () => {
    const grid = new OccupancyGrid();
    const camera: Vector3 = [0, 1.6, 0];
    // 5 phantom points 1 m BELOW the real floor (added first, so the later
    // floor rays cannot carve them — they sit under the surface).
    const noise: Vector3[] = [
      [-0.6, -1, -0.6],
      [0.6, -1, -0.6],
      [-0.6, -1, 0.6],
      [0.6, -1, 0.6],
      [0, -1, 0],
    ];
    grid.addSample(makeSample(camera, noise));
    grid.addSample(
      makeSample(
        camera,
        surfacePatch(() => 0, 0.9, 0.15)
      )
    );

    const est = estimateFloor(grid, camera, { minObservations: 1 });
    expect(est).not.toBeNull();
    // The 5-cell band is skipped (< minSupportCells 6); the real floor wins.
    expect(Math.abs(est!.floorYar)).toBeLessThan(0.03);
    expect(est!.confidence).toBeGreaterThan(0.8);
  });

  it('a 6-cell noise band that wins with exactly minSupport is reported with crushed confidence', () => {
    const grid = new OccupancyGrid();
    const camera: Vector3 = [0, 1.6, 0];
    const noise: Vector3[] = [
      [-0.6, -1, -0.6],
      [0.6, -1, -0.6],
      [-0.6, -1, 0.6],
      [0.6, -1, 0.6],
      [0, -1, -0.6],
      [0, -1, 0.6],
    ];
    grid.addSample(makeSample(camera, noise));
    grid.addSample(
      makeSample(
        camera,
        surfacePatch(() => 0, 0.9, 0.15)
      )
    );

    const est = estimateFloor(grid, camera, { minObservations: 1 });
    expect(est).not.toBeNull();
    // The lowest band DOES win with exactly minSupport cells — the estimator
    // reports it (callers gate), but the implausible 2.6 m camera height and
    // the thin support crush the confidence.
    expect(est!.floorYar).toBeCloseTo(-1, 1);
    expect(est!.support).toBe(6);
    expect(est!.heightAboveFloorM).toBeGreaterThan(PLAUSIBLE_HEIGHT_MAX_M);
    expect(est!.confidence).toBeLessThan(0.2);

    // Reference: the same scene WITHOUT the noise is a high-confidence floor.
    const clean = new OccupancyGrid();
    clean.addSample(
      makeSample(
        camera,
        surfacePatch(() => 0, 0.9, 0.15)
      )
    );
    const cleanEst = estimateFloor(clean, camera, { minObservations: 1 });
    expect(cleanEst!.confidence).toBeGreaterThan(0.8);
  });

  it('clamps a one-sided steep extrapolation to the exclusion line and hard-crushes confidence', () => {
    // Why this test matters: with support only on one side of the camera and
    // a steep local gradient, the fitted plane EVALUATED at the camera's XZ
    // can extrapolate above the exclusion line — a "floor" inside the band
    // the histogram was told to ignore. The clamp caps it at the line, the
    // `clamped` flag reports it, and the confidence is multiplied down hard
    // (×0.2) because a clamped extrapolation is the least trustworthy
    // geometry the estimator can return.
    const grid = new OccupancyGrid();
    const camera: Vector3 = [0, 1.0, 0];
    // −45° pitch: the camera looks down-forward at a steep ramp entirely on
    // its −z side (z ∈ [−2.5, −1.5], y rising toward the camera: 0.1..0.6).
    const lookDownForward: [number, number, number, number] = [
      -Math.sin(Math.PI / 8),
      0,
      0,
      Math.cos(Math.PI / 8),
    ];
    const ramp = surfacePatch(
      (_x, z) => 0.6 + 0.5 * (z + 1.5),
      0.5,
      0.15,
      0,
      -2
    );
    grid.addSample(makeSample(camera, ramp, lookDownForward));

    const est = estimateFloor(grid, camera, { minObservations: 1 });
    expect(est).not.toBeNull();
    // Every support point sits below the exclusion line (0.6), yet the
    // band's plane (dy/dz = 0.5) extrapolated to z = 0 would land at
    // ~1.35 m — above the camera exclusion line. It must be clamped there.
    expect(est!.clamped).toBe(true);
    expect(est!.floorYar).toBeCloseTo(
      camera[1] - DEFAULT_FLOOR_MIN_BELOW_CAMERA_M,
      6
    );
    expect(est!.heightAboveFloorM).toBeCloseTo(
      DEFAULT_FLOOR_MIN_BELOW_CAMERA_M,
      6
    );
    // Hard crush: plausibility decay alone would leave ~0.5 confidence for
    // the 0.4 m height; the ×0.2 clamp factor pushes it well below that.
    expect(est!.confidence).toBeLessThan(0.15);
  });

  it('answers null for an empty grid', () => {
    expect(estimateFloor(new OccupancyGrid(), [0, 1.7, 0])).toBeNull();
  });

  it('answers null when every occupied cell is above the camera exclusion line', () => {
    const grid = new OccupancyGrid();
    // A ceiling at y = 2, observed by a camera looking straight up.
    const ceilingCamera: Vector3 = [0, 0.5, 0];
    grid.addSample(
      makeSample(
        ceilingCamera,
        surfacePatch(() => 2, 0.6, 0.15),
        LOOK_UP
      )
    );
    expect(
      estimateFloor(grid, ceilingCamera, { minObservations: 1 })
    ).toBeNull();
  });

  it('confidence decays monotonically outside the [0.5, 2.5] m plausible-height band', () => {
    const grid = new OccupancyGrid();
    const buildCamera: Vector3 = [0, 1.7, 0];
    grid.addSample(
      makeSample(
        buildCamera,
        surfacePatch(() => 0, 1.0, 0.15)
      )
    );

    const confAt = (h: number): number => {
      const est = estimateFloor(grid, [0, h, 0], { minObservations: 1 });
      expect(est).not.toBeNull();
      return est!.confidence;
    };

    // High side: full confidence up to the 2.5 m edge, strictly decaying beyond.
    const high = [1.7, 2.5, 2.7, 2.9].map(confAt);
    for (let i = 1; i < high.length; i++) {
      expect(high[i]!).toBeLessThanOrEqual(high[i - 1]!);
    }
    expect(high[2]!).toBeLessThan(high[1]!);
    expect(high[3]!).toBeLessThan(high[2]!);

    // Low side: same shape below the 0.5 m edge.
    const low = [1.0, 0.5, 0.45, 0.42].map(confAt);
    for (let i = 1; i < low.length; i++) {
      expect(low[i]!).toBeLessThanOrEqual(low[i - 1]!);
    }
    expect(low[2]!).toBeLessThan(low[1]!);
    expect(low[3]!).toBeLessThan(low[2]!);
  });

  it('defaults minObservations to the framework noise floor (2): single-observation cells are invisible', () => {
    const grid = new OccupancyGrid();
    const camera: Vector3 = [0, 1.7, 0];
    grid.addSample(
      makeSample(
        camera,
        surfacePatch(() => 0, 0.9, 0.15)
      )
    );
    // Every cell has exactly one observation — below the default floor of 2.
    expect(estimateFloor(grid, camera)).toBeNull();
    expect(estimateFloor(grid, camera, { minObservations: 1 })).not.toBeNull();
  });

  it('returns null for a non-finite camera position (tracking glitch policy)', () => {
    const grid = new OccupancyGrid();
    const camera: Vector3 = [0, 1.7, 0];
    grid.addSample(
      makeSample(
        camera,
        surfacePatch(() => 0, 0.9, 0.15)
      )
    );
    expect(
      estimateFloor(grid, [NaN, 1.7, 0], { minObservations: 1 })
    ).toBeNull();
    expect(
      estimateFloor(grid, [0, Infinity, 0], { minObservations: 1 })
    ).toBeNull();
  });

  it('rejects invalid options with RangeError (module-boundary validation)', () => {
    const grid = new OccupancyGrid();
    const camera: Vector3 = [0, 1.7, 0];
    expect(() => estimateFloor(grid, camera, { queryRadiusM: 0 })).toThrow(
      RangeError
    );
    expect(() => estimateFloor(grid, camera, { queryRadiusM: NaN })).toThrow(
      RangeError
    );
    expect(() =>
      estimateFloor(grid, camera, { minBelowCameraM: -0.1 })
    ).toThrow(RangeError);
    expect(() =>
      estimateFloor(grid, camera, { minBelowCameraM: Infinity })
    ).toThrow(RangeError);
    expect(() => estimateFloor(grid, camera, { minSupportCells: 0 })).toThrow(
      RangeError
    );
    expect(() => estimateFloor(grid, camera, { minSupportCells: 1.5 })).toThrow(
      RangeError
    );
    expect(() => estimateFloor(grid, camera, { bandCells: 0 })).toThrow(
      RangeError
    );
    expect(() => estimateFloor(grid, camera, { minObservations: 0 })).toThrow(
      RangeError
    );
  });
});
