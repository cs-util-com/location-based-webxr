/**
 * Property tests for the hex-tiled cloud octave (hex-tiling plan
 * 2026-10-07-0919, H1). Why this file matters: the field is read at every
 * pixel at every drift offset; a jump anywhere is a seam on the sky, and
 * no fixed list of points crosses every cell edge.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { hexCorners, hexTiledSample } from './cloud-hex.js';

/** A smooth, 1-periodic texture with a gradient no steeper than 2 pi x 1.3. */
const texture = (u: number, v: number) =>
  0.5 +
  0.25 * Math.sin(2 * Math.PI * u) * Math.cos(2 * Math.PI * v) +
  0.05 * Math.sin(2 * Math.PI * (u + v));

const coordinate = fc
  .integer({ min: -50_000_000, max: 50_000_000 })
  .map((i) => i / 1_000_000);

describe('hexTiledSample properties', () => {
  // Continuity, the drift's included (moving the offset moves the point):
  // the blend's weights reach 0 at each corner's far edge, so a step of
  // 1e-6 tile changes the field by a bounded amount everywhere.
  it('is continuous everywhere, across every cell edge', () => {
    fc.assert(
      fc.property(
        coordinate,
        coordinate,
        fc.constantFrom(1, 2, 3),
        (u, v, k) => {
          const e = 1e-6;
          const at = hexTiledSample(texture, u, v, 0.5, { cellsPerTile: k });
          const du = hexTiledSample(texture, u + e, v, 0.5, {
            cellsPerTile: k,
          });
          const dv = hexTiledSample(texture, u, v + e, 0.5, {
            cellsPerTile: k,
          });
          expect(Math.abs(du - at)).toBeLessThan(1e-3);
          expect(Math.abs(dv - at)).toBeLessThan(1e-3);
        }
      ),
      { numRuns: 2_000 }
    );
  });

  it('weights its corners by barycentric shares that sum to 1', () => {
    fc.assert(
      fc.property(
        coordinate,
        coordinate,
        fc.constantFrom(1, 2, 3),
        (u, v, k) => {
          const { weights } = hexCorners(u, v, k);
          expect(weights[0] + weights[1] + weights[2]).toBeCloseTo(1, 9);
          for (const w of weights) {
            expect(w).toBeGreaterThanOrEqual(-1e-9);
            expect(w).toBeLessThanOrEqual(1 + 1e-9);
          }
        }
      ),
      { numRuns: 2_000 }
    );
  });
});
