/**
 * Occupancy-grid fold ORACLE property test.
 *
 * Why this test matters (2026-07-17 perf loop, iteration 1): `carve()` no
 * longer calls the generic `bresenham3d` tracer — the walk is fused into the
 * method with an incrementally-maintained packed key (see the carve() doc
 * comment for the numbers). That fusion must be a PURE refactor: for every
 * possible depth-sample stream the grid must end up in exactly the state the
 * pre-fusion implementation produced. This test freezes the pre-fusion fold
 * as an independent oracle built on the ORIGINAL building blocks
 * (`bresenham3d` + `cellKey` + a plain Map) and asserts full observable-state
 * equivalence (occupied sets at several floors, per-cell counts via floors,
 * exact centroid positions, exact colors) over randomized workloads covering
 * guarded (threshold 1/2) and legacy (undefined) carving.
 *
 * If a future change is SUPPOSED to alter fold semantics, the oracle must be
 * updated deliberately, in the same commit, with the behavior change called
 * out — never loosened to "make the test pass".
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { mat4 } from 'gl-matrix';
import type { Matrix4, Vector3 } from 'gps-plus-slam-js';
import type { DepthSample, RgbTuple } from '../types/ar-types';
import { OccupancyGrid } from './occupancy-grid';
import { bresenham3d, type GridCell } from './bresenham3d';
import { CELL_KEY_LIMIT, cellCoordsInKeyRange, cellKey } from './cell-key';
import { createDepthUnprojector } from './depth-unprojection';

const PROJECTION: Matrix4 = Array.from(
  mat4.perspective(mat4.create(), Math.PI / 3, 16 / 9, 0.1, 1000)
) as unknown as Matrix4;

interface OracleRecord {
  count: number;
  posSumX: number;
  posSumY: number;
  posSumZ: number;
  colorCount: number;
  colorSumR: number;
  colorSumG: number;
  colorSumB: number;
}

interface OracleOptions {
  cellSizeM: number;
  carveStopCells: number;
  carveConfidenceThreshold: number | undefined;
}

/**
 * FROZEN pre-fusion fold (verbatim semantics of OccupancyGrid.addSample at
 * commit 8fac3a6, minus the chunk/revision bookkeeping this test does not
 * compare): two passes per sample, per-sample unique-endpoint carve dedupe,
 * carving via the generic bresenham3d tracer, decay-guarded or legacy delete.
 */
function oracleFold(
  samples: readonly DepthSample[],
  opts: OracleOptions
): Map<number, OracleRecord> {
  const cells = new Map<number, OracleRecord>();
  const cs = opts.cellSizeM;
  const cellFor = (p: Vector3): GridCell => [
    Math.round(p[0] / cs) + 0,
    Math.round(p[1] / cs) + 0,
    Math.round(p[2] / cs) + 0,
  ];
  const isFiniteTriple = (v: readonly number[]): boolean =>
    Number.isFinite(v[0]) && Number.isFinite(v[1]) && Number.isFinite(v[2]);
  const cellsEqual = (a: GridCell, b: GridCell): boolean =>
    a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

  const decay = (key: number, record: OracleRecord): void => {
    const newCount = record.count - 1;
    if (newCount <= 0) {
      cells.delete(key);
      return;
    }
    const scale = newCount / record.count;
    record.count = newCount;
    record.posSumX *= scale;
    record.posSumY *= scale;
    record.posSumZ *= scale;
    if (record.colorCount > newCount) {
      const colorScale = newCount / record.colorCount;
      record.colorSumR *= colorScale;
      record.colorSumG *= colorScale;
      record.colorSumB *= colorScale;
      record.colorCount = newCount;
    }
  };

  const carve = (cameraCell: GridCell, pointCell: GridCell): void => {
    const threshold = opts.carveConfidenceThreshold;
    bresenham3d(
      cameraCell,
      pointCell,
      (cell) => {
        if (!cellsEqual(cell, pointCell)) {
          const key = cellKey(cell);
          if (threshold !== undefined) {
            const record = cells.get(key);
            if (!record) {
              return true;
            }
            if (record.count >= threshold) {
              decay(key, record);
              return false;
            }
          }
          cells.delete(key);
        }
        return true;
      },
      opts.carveStopCells
    );
  };

  const increment = (cell: GridCell, world: Vector3, rgb?: RgbTuple): void => {
    const key = cellKey(cell);
    let record = cells.get(key);
    if (!record) {
      record = {
        count: 0,
        posSumX: 0,
        posSumY: 0,
        posSumZ: 0,
        colorCount: 0,
        colorSumR: 0,
        colorSumG: 0,
        colorSumB: 0,
      };
      cells.set(key, record);
    }
    record.count++;
    record.posSumX += world[0];
    record.posSumY += world[1];
    record.posSumZ += world[2];
    if (rgb && isFiniteTriple(rgb)) {
      record.colorCount++;
      record.colorSumR += rgb[0];
      record.colorSumG += rgb[1];
      record.colorSumB += rgb[2];
    }
  };

  // Pass 1 of a sample: unproject every point, carve once per unique
  // endpoint cell, and collect the endpoints for pass 2.
  const collectAndCarve = (
    sample: DepthSample,
    unprojector: NonNullable<ReturnType<typeof createDepthUnprojector>>,
    cameraCell: GridCell
  ): Array<{ cell: GridCell; world: Vector3; rgb?: RgbTuple }> => {
    const cameraInRange = cellCoordsInKeyRange(cameraCell, CELL_KEY_LIMIT);
    const carvedEndpointKeys = new Set<number>();
    const endpoints: Array<{ cell: GridCell; world: Vector3; rgb?: RgbTuple }> =
      [];
    for (const point of sample.points) {
      const world = unprojector.unproject(point);
      if (!world) {
        continue;
      }
      const cell = cellFor(world);
      if (!cellCoordsInKeyRange(cell, CELL_KEY_LIMIT)) {
        continue;
      }
      if (cameraInRange && !cellsEqual(cameraCell, cell)) {
        const key = cellKey(cell);
        if (!carvedEndpointKeys.has(key)) {
          carvedEndpointKeys.add(key);
          carve(cameraCell, cell);
        }
      }
      endpoints.push({ cell, world, rgb: point.rgb });
    }
    return endpoints;
  };

  const foldSample = (sample: DepthSample): void => {
    if (!isFiniteTriple(sample.cameraPos)) {
      return;
    }
    const unprojector = createDepthUnprojector(
      sample.cameraPos,
      sample.cameraRot,
      sample.projectionMatrix
    );
    if (!unprojector) {
      return;
    }
    const endpoints = collectAndCarve(
      sample,
      unprojector,
      cellFor(sample.cameraPos)
    );
    for (const endpoint of endpoints) {
      increment(endpoint.cell, endpoint.world, endpoint.rgb);
    }
  };

  for (const sample of samples) {
    foldSample(sample);
  }
  return cells;
}

/** Sorted packed keys of the oracle cells with count ≥ floor. */
function oracleOccupiedKeys(
  cells: Map<number, OracleRecord>,
  floor: number
): number[] {
  const keys: number[] = [];
  for (const [key, record] of cells) {
    if (record.count >= floor) {
      keys.push(key);
    }
  }
  return keys.sort((a, b) => a - b);
}

const arbRgb = fc.tuple(
  fc.integer({ min: 0, max: 255 }),
  fc.integer({ min: 0, max: 255 }),
  fc.integer({ min: 0, max: 255 })
) as fc.Arbitrary<RgbTuple>;

const arbPoint = fc.record({
  screenX: fc.double({ min: 0.05, max: 0.95, noNaN: true }),
  screenY: fc.double({ min: 0.05, max: 0.95, noNaN: true }),
  depthM: fc.double({ min: 0.3, max: 6, noNaN: true }),
  rgb: fc.option(arbRgb, { nil: undefined }),
});

const arbCoord = fc.double({ min: -2, max: 2, noNaN: true });

const arbSample: fc.Arbitrary<DepthSample> = fc.record({
  timestamp: fc.constant(0),
  cameraPos: fc.tuple(arbCoord, arbCoord, arbCoord),
  // Identity rotation keeps the geometry easy to reason about; rotation is
  // orthogonal to carve semantics (it only moves the endpoints, and random
  // cameras already vary the rays' directions).
  cameraRot: fc.constant<[number, number, number, number]>([0, 0, 0, 1]),
  points: fc.array(arbPoint, { minLength: 1, maxLength: 40 }),
  projectionMatrix: fc.constant(PROJECTION),
});

describe('OccupancyGrid fold matches the frozen pre-fusion oracle', () => {
  it('occupied sets, centroids and colors are identical for random depth streams', () => {
    fc.assert(
      fc.property(
        fc.array(arbSample, { minLength: 1, maxLength: 6 }),
        fc.constantFrom<number | undefined>(undefined, 1, 2),
        fc.constantFrom(0, 2),
        (samples, threshold, carveStopCells) => {
          const grid = new OccupancyGrid({
            cellSizeM: 0.16,
            carveStopCells,
            carveConfidenceThreshold: threshold,
          });
          for (const sample of samples) {
            grid.addSample(sample);
          }
          const oracle = oracleFold(samples, {
            cellSizeM: 0.16,
            carveStopCells,
            carveConfidenceThreshold: threshold,
          });

          // Same occupied set at several floors (floor 1 = full key set;
          // higher floors pin the per-cell counts, incl. decay effects).
          for (const floor of [1, 2, 3]) {
            const gridKeys = grid
              .getOccupiedCells(floor)
              .map((cell) => cellKey(cell))
              .sort((a, b) => a - b);
            expect(gridKeys).toEqual(oracleOccupiedKeys(oracle, floor));
          }

          // Exact centroid + color equality per cell: the fused walk performs
          // the same float operations in the same order as the oracle, so
          // results must be bit-identical, not just close.
          for (const [key, record] of oracle) {
            const cell: GridCell = unpack(key);
            expect(grid.getCellPoint(cell)).toEqual([
              record.posSumX / record.count,
              record.posSumY / record.count,
              record.posSumZ / record.count,
            ]);
            const expectedColor =
              record.colorCount === 0
                ? null
                : ([
                    clamp255(record.colorSumR / record.colorCount),
                    clamp255(record.colorSumG / record.colorCount),
                    clamp255(record.colorSumB / record.colorCount),
                  ] as RgbTuple);
            expect(grid.getCellColor(cell)).toEqual(expectedColor);
          }
        }
      )
    );
  });
});

function clamp255(v: number): number {
  return Math.min(255, Math.max(0, Math.round(v)));
}

/** Local unpack (inverse of cellKey) so the test does not depend on grid internals. */
function unpack(key: number): [number, number, number] {
  const KEY_OFFSET = 65536;
  const KEY_FIELD = 131072;
  const KEY_FIELD_SQ = KEY_FIELD * KEY_FIELD;
  return [
    Math.floor(key / KEY_FIELD_SQ) - KEY_OFFSET,
    (Math.floor(key / KEY_FIELD) % KEY_FIELD) - KEY_OFFSET,
    (key % KEY_FIELD) - KEY_OFFSET,
  ];
}
