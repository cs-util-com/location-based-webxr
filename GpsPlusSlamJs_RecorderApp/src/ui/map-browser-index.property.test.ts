/**
 * Property tests for the map-browser pure logic.
 *
 * Why this matters:
 * The tile index and name filter run over arbitrary recording sets and zoom
 * levels. These properties assert the structural invariants hold across many
 * generated inputs — the tile membership is sound (every listed recording truly
 * crosses the tile), recordings never double-count in a tile, and the name
 * filter is a stable subset operation.
 *
 * @see ./map-browser-index.test.ts for worked examples
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { isValidCell } from 'h3-js';
import {
  H3_RESOLUTION,
  clusterCellsByZoom,
  gpsPathToCoverageCells,
} from 'gps-plus-slam-app-framework/geo';
import {
  leafletZoomToH3Res,
  buildTileIndex,
  filterRecordingsByName,
} from './map-browser-index';
import type { RecordingCoverage } from './recording-index';

/**
 * Uniform over `[min, max]` on a 1e-6 grid. Not `fc.double`, which spreads
 * its draws over the floating-point representations: about 91 % of them land
 * within 1e-6 of zero, so "any place" sampled one place.
 */
function uniformIn(min: number, max: number): fc.Arbitrary<number> {
  // noBias: by default fast-check skews integers toward zero and the bounds.
  return fc
    .noBias(
      fc.integer({ min: Math.round(min * 1e6), max: Math.round(max * 1e6) })
    )
    .map((micro) => micro / 1e6);
}

const latArb = uniformIn(-85, 85);
const lngArb = uniformIn(-180, 180);
const pathArb = fc.array(fc.record({ lat: latArb, lng: lngArb }), {
  maxLength: 12,
});

const recArb: fc.Arbitrary<RecordingCoverage> = fc
  .record({
    filename: fc.string({ minLength: 1, maxLength: 8 }),
    path: pathArb,
  })
  .map(({ filename, path }) => ({
    entry: {
      filename: `${filename}.zip`,
      fileHandle: {} as unknown as FileSystemFileHandle,
      date: null,
      h3Cells: gpsPathToCoverageCells(path),
    },
    scenario: 'S',
    cells: gpsPathToCoverageCells(path),
    backfilled: false,
  }));

describe('leafletZoomToH3Res — properties', () => {
  it('always returns an integer in [0, H3_RESOLUTION] and is monotonic', () => {
    fc.assert(
      fc.property(uniformIn(-50, 50), uniformIn(-50, 50), (z1, z2) => {
        const lo = Math.min(z1, z2);
        const hi = Math.max(z1, z2);
        const rLo = leafletZoomToH3Res(lo);
        const rHi = leafletZoomToH3Res(hi);
        for (const r of [rLo, rHi]) {
          expect(Number.isInteger(r)).toBe(true);
          expect(r).toBeGreaterThanOrEqual(0);
          expect(r).toBeLessThanOrEqual(H3_RESOLUTION);
        }
        expect(rHi).toBeGreaterThanOrEqual(rLo);
      })
    );
  });
});

describe('buildTileIndex — properties', () => {
  const resArb = fc.integer({ min: 0, max: H3_RESOLUTION });

  it('tile keys are valid cells and membership is sound', () => {
    fc.assert(
      fc.property(fc.array(recArb, { maxLength: 6 }), resArb, (recs, res) => {
        const index = buildTileIndex(recs, res);
        for (const [tile, listed] of index.tilesToRecordings) {
          expect(isValidCell(tile)).toBe(true);
          // No recording appears twice under the same tile.
          expect(new Set(listed).size).toBe(listed.length);
          // Every listed recording genuinely clusters to this tile.
          for (const r of listed) {
            expect(clusterCellsByZoom(r.cells, res)).toContain(tile);
          }
        }
      })
    );
  });

  it('every covered tile of every recording is indexed', () => {
    fc.assert(
      fc.property(fc.array(recArb, { maxLength: 6 }), resArb, (recs, res) => {
        const index = buildTileIndex(recs, res);
        for (const r of recs) {
          for (const tile of clusterCellsByZoom(r.cells, res)) {
            expect(index.tilesToRecordings.get(tile)).toContain(r);
          }
        }
      })
    );
  });
});

describe('filterRecordingsByName — properties', () => {
  it('is always a subset of the input, preserving order', () => {
    fc.assert(
      fc.property(
        fc.array(recArb, { maxLength: 8 }),
        fc.string({ maxLength: 5 }),
        (recs, query) => {
          const filtered = filterRecordingsByName(recs, query);
          expect(filtered.length).toBeLessThanOrEqual(recs.length);
          // Order-preserving subsequence.
          let i = 0;
          for (const r of recs) {
            if (r === filtered[i]) i++;
          }
          expect(i).toBe(filtered.length);
        }
      )
    );
  });

  it('an empty query is the identity', () => {
    fc.assert(
      fc.property(fc.array(recArb, { maxLength: 8 }), (recs) => {
        expect(filterRecordingsByName(recs, '')).toEqual(recs);
      })
    );
  });
});
