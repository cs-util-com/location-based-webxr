/**
 * Property tests for `pinholeFromProjection`.
 *
 * Why this test file matters: the focal lengths and principal point
 * recovered from a synthetic perspective matrix must match the values it
 * was built from, for any field of view, aspect, resolution and principal
 * point. Identity-like fixtures hide sign errors in the offset terms; a
 * round trip over the whole space does not.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import type { Matrix4 } from 'gps-plus-slam-js';

import { pinholeFromProjection } from './pinhole-from-projection';

const finite = (min: number, max: number) =>
  fc.double({ min, max, noNaN: true, noDefaultInfinity: true });

/**
 * Build a column-major OpenGL-style perspective projection matrix from the
 * PINHOLE intrinsics - the algebraic inverse of `pinholeFromProjection`, so a
 * round trip must recover the inputs. (Depth terms are arbitrary; intrinsics
 * are resolution/normalization-only and do not depend on near/far.)
 */
function projectionFromIntrinsics(
  fx: number,
  fy: number,
  cx: number,
  cy: number,
  width: number,
  height: number
): Matrix4 {
  const m = new Array(16).fill(0) as number[];
  m[0] = (2 * fx) / width; // m00
  m[5] = (2 * fy) / height; // m11
  m[8] = 1 - (2 * cx) / width; // m20
  m[9] = (2 * cy) / height - 1; // m21
  m[10] = -1; // arbitrary depth term
  m[11] = -1; // w = -z_view
  m[14] = -0.2; // arbitrary depth term
  return m as unknown as Matrix4;
}

describe('pinholeFromProjection (property)', () => {
  it('recovers the intrinsics a synthetic perspective matrix was built from', () => {
    fc.assert(
      fc.property(
        finite(100, 3000), // fx
        finite(100, 3000), // fy
        fc.integer({ min: 160, max: 4096 }), // width
        fc.integer({ min: 160, max: 4096 }), // height
        finite(0.1, 0.9), // cx fraction of width
        finite(0.1, 0.9), // cy fraction of height
        (fx, fy, width, height, cxFrac, cyFrac) => {
          const cx = cxFrac * width;
          const cy = cyFrac * height;
          const m = projectionFromIntrinsics(fx, fy, cx, cy, width, height);
          const intr = pinholeFromProjection(m, width, height);
          expect(intr.fx).toBeCloseTo(fx, 4);
          expect(intr.fy).toBeCloseTo(fy, 4);
          expect(intr.cx).toBeCloseTo(cx, 4);
          expect(intr.cy).toBeCloseTo(cy, 4);
        }
      ),
      { numRuns: 500 }
    );
  });
});
