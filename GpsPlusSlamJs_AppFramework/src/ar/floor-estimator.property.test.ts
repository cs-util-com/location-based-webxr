/**
 * Floor Estimator Property Tests.
 *
 * Why this test matters:
 * The estimator's hard invariants must hold for ANY plausible scene, not
 * just the handcrafted unit fixtures:
 * - the reported floor is never above the camera's exclusion line
 *   (cameraY − minBelowCameraM) — a "floor" hugging the camera would make
 *   every downstream height correction nonsense;
 * - every field of a returned estimate is finite and confidence stays in
 *   [0, 1] for arbitrary finite inputs (NaN poisoning a per-frame consumer
 *   would propagate into rendered transforms);
 * - re-adding the same samples (a static scene re-observed, the 1 Hz
 *   steady state) grows the grid revision but leaves the estimate
 *   invariant — the estimator must not drift under re-observation.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import type { Vector3 } from 'gps-plus-slam-js';
import { OccupancyGrid } from './occupancy-grid';
import { estimateFloor, type FloorEstimate } from './floor-estimator';
import {
  makeWorldPointSample as makeSample,
  surfacePatch,
} from '../test-utils/synthetic-depth-samples';

/**
 * A camera above a flat floor patch it can fully see: the patch is centered
 * on the camera's XZ and its extent stays inside the wide test frustum
 * (extent/height ≤ 0.9/0.6 = 1.5 < tan(1.1) ≈ 1.96), so `makeSample`'s
 * fixture guards never trip.
 */
const scenarioArb = fc.record({
  floorY: fc.double({ min: -2, max: 2, noNaN: true }),
  camHeight: fc.double({ min: 0.6, max: 2.4, noNaN: true }),
  camX: fc.double({ min: -1, max: 1, noNaN: true }),
  camZ: fc.double({ min: -1, max: 1, noNaN: true }),
  extentM: fc.double({ min: 0.5, max: 0.9, noNaN: true }),
  stepM: fc.double({ min: 0.15, max: 0.3, noNaN: true }),
});

type Scenario = {
  floorY: number;
  camHeight: number;
  camX: number;
  camZ: number;
  extentM: number;
  stepM: number;
};

function buildFloorGrid(s: Scenario): { grid: OccupancyGrid; camera: Vector3 } {
  const camera: Vector3 = [s.camX, s.floorY + s.camHeight, s.camZ];
  const grid = new OccupancyGrid();
  grid.addSample(
    makeSample(
      camera,
      surfacePatch(() => s.floorY, s.extentM, s.stepM, s.camX, s.camZ)
    )
  );
  return { grid, camera };
}

/**
 * Well-formedness predicate for the NaN-free property — a plain boolean so
 * the fast-check body stays free of conditional `expect`s
 * (vitest/no-conditional-expect); fast-check reports the failing scenario,
 * which is the useful diagnostic here.
 */
function isWellFormed(est: FloorEstimate): boolean {
  return (
    Number.isFinite(est.floorYar) &&
    Number.isFinite(est.heightAboveFloorM) &&
    Number.isFinite(est.slopeX) &&
    Number.isFinite(est.slopeZ) &&
    Number.isFinite(est.planeResidualM) &&
    est.confidence >= 0 &&
    est.confidence <= 1 &&
    Number.isSafeInteger(est.support) &&
    est.hits.length === est.support &&
    est.hits.every(
      (hit) =>
        Number.isFinite(hit.x) &&
        Number.isFinite(hit.y) &&
        Number.isFinite(hit.z)
    )
  );
}

describe('estimateFloor properties', () => {
  it('never reports a floor above cameraY − minBelowCameraM', () => {
    fc.assert(
      fc.property(
        scenarioArb,
        fc.double({ min: 0, max: 1, noNaN: true }),
        (s, minBelowCameraM) => {
          const { grid, camera } = buildFloorGrid(s);
          const est = estimateFloor(grid, camera, {
            minObservations: 1,
            minBelowCameraM,
          });
          expect(
            est === null || est.floorYar <= camera[1] - minBelowCameraM + 1e-9
          ).toBe(true);
          expect(
            est === null || est.heightAboveFloorM >= minBelowCameraM - 1e-9
          ).toBe(true);
        }
      ),
      { numRuns: 60 }
    );
  });

  it('is NaN-free: every field of an estimate is finite and confidence is in [0, 1]', () => {
    fc.assert(
      fc.property(
        scenarioArb,
        fc.tuple(
          fc.double({ min: -4, max: 4, noNaN: true }),
          fc.double({ min: -4, max: 4, noNaN: true }),
          fc.double({ min: -4, max: 4, noNaN: true })
        ),
        (s, queryCamera) => {
          const { grid } = buildFloorGrid(s);
          // The query camera is deliberately unrelated to the build camera —
          // any finite viewer position must produce null or a finite estimate.
          const est = estimateFloor(grid, queryCamera, { minObservations: 1 });
          expect(est === null || isWellFormed(est)).toBe(true);
        }
      ),
      { numRuns: 60 }
    );
  });

  it('re-adding the same samples grows the revision but leaves the estimate invariant', () => {
    fc.assert(
      fc.property(scenarioArb, (s) => {
        const camera: Vector3 = [s.camX, s.floorY + s.camHeight, s.camZ];
        const sample = makeSample(
          camera,
          surfacePatch(() => s.floorY, s.extentM, s.stepM, s.camX, s.camZ)
        );
        const grid = new OccupancyGrid();
        grid.addSample(sample);
        const before = estimateFloor(grid, camera, { minObservations: 1 });
        const revBefore = grid.getRevision();

        grid.addSample(sample); // static scene, re-observed
        const revAfter = grid.getRevision();
        const after = estimateFloor(grid, camera, { minObservations: 1 });

        // Re-observation is a grid mutation (counts still below the settled
        // ceiling), so the revision must grow…
        expect(revAfter).toBeGreaterThan(revBefore);
        // …but the estimate over the identical occupied set must not move
        // (per-cell means of identical points are identical up to fp order).
        // The drift metric is 0 when both are null and the max field delta
        // otherwise — computed unconditionally so no expect sits in a branch.
        expect(after === null).toBe(before === null);
        const drift =
          before && after
            ? Math.max(
                Math.abs(after.floorYar - before.floorYar),
                Math.abs(after.slopeX - before.slopeX),
                Math.abs(after.slopeZ - before.slopeZ),
                Math.abs(after.confidence - before.confidence),
                Math.abs(after.support - before.support)
              )
            : 0;
        expect(drift).toBeLessThan(1e-9);
      }),
      { numRuns: 60 }
    );
  });
});
