/**
 * H3 Coverage-Index Property Tests
 *
 * Why these tests matter:
 * The coverage helpers run over arbitrary recorded GPS paths and arbitrary map
 * zoom levels. Property-based tests assert the structural invariants hold for
 * thousands of generated inputs — not just the hand-picked Aachen coordinates
 * in the unit tests — catching ordering/dedup/validity regressions and pole/
 * antimeridian edge cases.
 *
 * @see ./h3-coverage.test.ts for the worked examples and the D1 regression guard
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { cellToParent, isValidCell } from 'h3-js';
import {
  gpsPathToCoverageCells,
  clusterCellsByZoom,
  gpsToH3,
  H3_RESOLUTION,
} from './h3-proximity';

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

// Full lat/lng ranges, including near the poles and the ±180° antimeridian, so
// the validity invariants are exercised at the seams h3-js must handle.
const latArb = uniformIn(-89.9, 89.9);
const lngArb = uniformIn(-180, 180);
const pathArb = fc.array(fc.record({ lat: latArb, lng: lngArb }), {
  maxLength: 60,
});

describe('gpsPathToCoverageCells — properties', () => {
  it('always returns valid, unique cells no longer than the input', () => {
    fc.assert(
      fc.property(pathArb, (path) => {
        const cells = gpsPathToCoverageCells(path);
        expect(cells.length).toBeLessThanOrEqual(path.length);
        expect(new Set(cells).size).toBe(cells.length); // unique
        expect(cells.every((c) => isValidCell(c))).toBe(true);
      })
    );
  });

  it('is order-stable: every cell appears at its first-seen index', () => {
    fc.assert(
      fc.property(pathArb, (path) => {
        const cells = gpsPathToCoverageCells(path);
        const firstSeen: string[] = [];
        const seen = new Set<string>();
        for (const p of path) {
          const c = gpsToH3(p.lat, p.lng);
          if (!seen.has(c)) {
            seen.add(c);
            firstSeen.push(c);
          }
        }
        expect(cells).toEqual(firstSeen);
      })
    );
  });
});

describe('clusterCellsByZoom — properties', () => {
  const coverageArb = pathArb.map((path) => gpsPathToCoverageCells(path));
  const resArb = fc.integer({ min: 0, max: H3_RESOLUTION });

  it('output is valid, unique, and no longer than the input', () => {
    fc.assert(
      fc.property(coverageArb, resArb, (cells, res) => {
        const clustered = clusterCellsByZoom(cells, res);
        expect(clustered.length).toBeLessThanOrEqual(cells.length);
        expect(new Set(clustered).size).toBe(clustered.length);
        expect(clustered.every((c) => isValidCell(c))).toBe(true);
      })
    );
  });

  it('each clustered cell is the cellToParent of an input cell', () => {
    fc.assert(
      fc.property(coverageArb, resArb, (cells, res) => {
        const clustered = clusterCellsByZoom(cells, res);
        const expectedParents = new Set(cells.map((c) => cellToParent(c, res)));
        expect(clustered.every((c) => expectedParents.has(c))).toBe(true);
      })
    );
  });

  it('clustering at H3_RESOLUTION is the identity on res-11 coverage', () => {
    fc.assert(
      fc.property(coverageArb, (cells) => {
        expect(clusterCellsByZoom(cells, H3_RESOLUTION)).toEqual(cells);
      })
    );
  });

  it('is monotonic: coarser resolutions never produce more tiles', () => {
    fc.assert(
      fc.property(coverageArb, resArb, resArb, (cells, ra, rb) => {
        const lo = Math.min(ra, rb);
        const hi = Math.max(ra, rb);
        expect(clusterCellsByZoom(cells, lo).length).toBeLessThanOrEqual(
          clusterCellsByZoom(cells, hi).length
        );
      })
    );
  });
});
