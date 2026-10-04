/**
 * Occupancy grid — long-session scaling harness (2026-07-03 long-session fps
 * plan, acceptance criterion for Steps 1–3).
 *
 * Why this test matters: the plan's core claim is that consumer refresh cost
 * is now **bounded by the local neighbourhood** — independent of total
 * explored area — via the chunk-indexed windowed queries. The 2026-07-02 walk
 * corpus measured 87k–124k real cells after ~5 minutes, so the plan
 * calibrates the harness at 20k vs 200k cells (a 10× spread bracketing the
 * corpus). Two gates:
 *
 * 1. DETERMINISTIC: a fully-interior window over locally-identical geometry
 *    must return exactly the same cell count on the small and the large grid
 *    — the windowed OUTPUT is provably independent of total size.
 * 2. TIMING (loose, regression-catching): the windowed query on the 10×
 *    grid must stay within 4× of the small grid's time (an O(total-cells)
 *    regression would show ~10×). Wall-clock gates are deliberately loose —
 *    CI timing is machine-dependent (same policy as
 *    `occupancy-mesher.perf.test.ts`); exact numbers are logged for humans.
 *
 * A bytes-per-cell probe (Step 3.1's CellRecord flattening) is logged
 * informationally — heap deltas are GC-noisy, so it never gates.
 */

import { describe, it, expect } from 'vitest';
import { buildSyntheticSurfaceGrid } from '../test-utils/synthetic-occupancy-grid';
import type { OccupancyGrid } from './occupancy-grid';
import type { Vector3 } from 'gps-plus-slam-js';

/** ~20k cells (141² sheet) and ~200k cells (448² sheet), 0.15 m cells. */
const SMALL_EDGE = 141;
const LARGE_EDGE = 448;
const CELL_SIZE_M = 0.15;
/** Fully interior in BOTH slabs (half-extents 10.6 m / 33.6 m). */
const WINDOW_RADIUS_M = 5;
const MIN_OBSERVATIONS = 3;

/**
 * Slab centre in meters, snapped to an exact CELL CENTER (integer cell
 * coordinates) so the rasterized query disc is bit-identical between the odd
 * and even slab edges — the deterministic gate compares the two counts.
 * (See synthetic-occupancy-grid.ts for the slab layout.)
 */
function slabCenter(edge: number): Vector3 {
  const kBase = -(edge + edge + 16);
  return [
    Math.floor(edge / 2) * CELL_SIZE_M,
    0,
    (kBase + Math.floor(edge / 2)) * CELL_SIZE_M,
  ];
}

/** Best-of-N wall-clock of one windowed query (min damps scheduler noise). */
function timeWindowedQuery(grid: OccupancyGrid, center: Vector3): number {
  let best = Infinity;
  for (let i = 0; i < 15; i++) {
    const t0 = performance.now();
    grid.getOccupiedCellsWithin(center, WINDOW_RADIUS_M, MIN_OBSERVATIONS);
    best = Math.min(best, performance.now() - t0);
  }
  return best;
}

describe('occupancy-grid long-session scaling (fps plan Steps 1–3 acceptance)', () => {
  it(
    'windowed query output and cost are independent of total explored area (20k vs 200k cells)',
    { timeout: 120_000 },
    () => {
      const small = buildSyntheticSurfaceGrid({
        cellsX: SMALL_EDGE,
        cellsZ: SMALL_EDGE,
        cellSizeM: CELL_SIZE_M,
      });
      const large = buildSyntheticSurfaceGrid({
        cellsX: LARGE_EDGE,
        cellsZ: LARGE_EDGE,
        cellSizeM: CELL_SIZE_M,
      });
      expect(small.grid.size).toBe(SMALL_EDGE * SMALL_EDGE);
      expect(large.grid.size).toBe(LARGE_EDGE * LARGE_EDGE);

      // Gate 1 (deterministic): identical local geometry ⇒ identical windowed
      // result, regardless of how much else the grid remembers.
      const smallWindow = small.grid.getOccupiedCellsWithin(
        slabCenter(SMALL_EDGE),
        WINDOW_RADIUS_M,
        MIN_OBSERVATIONS
      );
      const largeWindow = large.grid.getOccupiedCellsWithin(
        slabCenter(LARGE_EDGE),
        WINDOW_RADIUS_M,
        MIN_OBSERVATIONS
      );
      expect(largeWindow.length).toBe(smallWindow.length);
      expect(smallWindow.length).toBeGreaterThan(0);

      // Gate 2 (loose timing): 10× the cells must NOT cost ~10× the window.
      const smallMs = timeWindowedQuery(small.grid, slabCenter(SMALL_EDGE));
      const largeMs = timeWindowedQuery(large.grid, slabCenter(LARGE_EDGE));
      // Informational for humans reading the CI log (mesher-harness policy).
      console.log(
        `[perf] windowed query (r=${WINDOW_RADIUS_M} m, ${smallWindow.length} cells): ` +
          `${small.grid.size} cells → ${smallMs.toFixed(3)} ms | ` +
          `${large.grid.size} cells → ${largeMs.toFixed(3)} ms`
      );
      expect(largeMs).toBeLessThan(Math.max(4 * smallMs, 5));

      // Informational bytes-per-cell probe (Step 3.1 CellRecord flattening).
      // Heap deltas are GC-noisy → never gates; the trend is what matters
      // (~201 B/cell measured before the flattening, 2026-06-30 Round 5).
      // OPT-IN with DEBUG_PERF=1 (gate-speed plan 2026-10-04, G3): it builds a
      // third, 100k-cell grid only to print a line, and the framework's vitest
      // config runs `silent`, so in a gate run nobody ever saw it. (A plain
      // `--silent=false` / `--no-silent` on the command line did not surface the
      // line either, 2026-10-04; whoever needs the number should print it from
      // a debugger or a scratch copy of this test.)
      const node = (
        globalThis as {
          process?: {
            memoryUsage?: () => { heapUsed: number };
            env?: Record<string, string | undefined>;
          };
        }
      ).process;
      const memory = node?.memoryUsage;
      if (memory && node?.env?.['DEBUG_PERF'] === '1') {
        const before = memory().heapUsed;
        const probe = buildSyntheticSurfaceGrid({
          cellsX: 316,
          cellsZ: 316, // ~100k cells, the corpus regime
          cellSizeM: CELL_SIZE_M,
        });
        const bytesPerCell = (memory().heapUsed - before) / probe.grid.size;
        console.log(
          `[perf] ~${probe.grid.size} cells ≈ ${bytesPerCell.toFixed(0)} B/cell (informational; pre-flattening baseline ~201 B/cell)`
        );
      }
    }
  );
});
