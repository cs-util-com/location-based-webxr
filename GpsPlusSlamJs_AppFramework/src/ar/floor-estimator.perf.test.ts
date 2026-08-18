/**
 * Floor estimator — per-call cost at corpus grid scale (cold-review F5).
 *
 * Why this test matters: the OsmDemo ticks `estimateFloor` at ~1 Hz inside
 * the XR frame loop, against a grid that keeps growing for the whole
 * session — the 2026-07-02 walk corpus measured 87k–124k cells after ~5
 * minutes. Nothing else measures the estimator's cost at that size: its
 * unit tests run on tens of cells, and a regression that made the call scan
 * the WHOLE grid instead of the 3 m query window (the exact O(total-cells)
 * failure `occupancy-grid.perf.test.ts` guards on the query itself) would
 * ship as a mid-session frame hitch no functional test can see.
 *
 * Same harness policy as `occupancy-grid.perf.test.ts`: the grid is built
 * through the genuine `addSample` path (synthetic depth samples), the
 * timing is best-of-N (min damps scheduler noise), the wall-clock gate is
 * deliberately GENEROUS because CI timing is machine-dependent, and the
 * exact number is logged for humans.
 *
 * Isolated local runtime (2026-08-18, Windows/node 22): the measured
 * best-of-15 call was 0.44 ms on the 99 856-cell grid (793 supporting band
 * cells inside the 3 m query radius) — the 50 ms ceiling is >100× headroom,
 * sized to catch an accidental full-grid scan (well over 100 ms at this
 * size), not to police jitter.
 */

import { describe, it, expect } from 'vitest';
import { buildSyntheticSurfaceGrid } from '../test-utils/synthetic-occupancy-grid';
import { estimateFloor } from './floor-estimator';

/** ~100k cells (316² sheet) at the PRODUCTION cell size the corpus uses. */
const EDGE = 316;
const CELL_SIZE_M = 0.16;
/** Camera eye height above the synthetic floor sheet, metres. */
const EYE_HEIGHT_M = 1.6;
/**
 * Generous per-call ceiling, ms. The measured cost is ~1–2 ms (see header);
 * an O(total-cells) regression lands two orders of magnitude above this.
 */
const PER_CALL_CEILING_MS = 50;
const TIMING_RUNS = 15;

describe('floor-estimator perf at corpus grid scale (~100k cells)', () => {
  it(
    'estimates from a 100k-cell grid within the per-call budget',
    { timeout: 120_000 },
    () => {
      const { grid } = buildSyntheticSurfaceGrid({
        cellsX: EDGE,
        cellsZ: EDGE,
        cellSizeM: CELL_SIZE_M,
      });
      expect(grid.size).toBe(EDGE * EDGE);

      // Camera above the slab centre: the sheet's cells sit at y ≈ 0 (the
      // builder's slab layout), pushed into −Z; the estimator's 3 m query
      // window is fully interior at this position.
      const kBase = -(EDGE + 1 + EDGE + 16);
      const cameraPos: [number, number, number] = [
        Math.floor(EDGE / 2) * CELL_SIZE_M,
        EYE_HEIGHT_M,
        (kBase + Math.floor(EDGE / 2)) * CELL_SIZE_M,
      ];

      // The estimate must be REAL work, or the timing measures a null path.
      const estimate = estimateFloor(grid, cameraPos);
      expect(estimate).not.toBeNull();
      expect(estimate!.support).toBeGreaterThanOrEqual(6);
      expect(estimate!.heightAboveFloorM).toBeCloseTo(EYE_HEIGHT_M, 1);

      let bestMs = Infinity;
      for (let i = 0; i < TIMING_RUNS; i++) {
        const t0 = performance.now();
        estimateFloor(grid, cameraPos);
        bestMs = Math.min(bestMs, performance.now() - t0);
      }
      // Informational for humans reading the CI log (harness policy).
      console.log(
        `[perf] estimateFloor on ${grid.size} cells (support ${estimate!.support}): ` +
          `best-of-${TIMING_RUNS} ${bestMs.toFixed(3)} ms`
      );
      expect(bestMs).toBeLessThan(PER_CALL_CEILING_MS);
    }
  );
});
