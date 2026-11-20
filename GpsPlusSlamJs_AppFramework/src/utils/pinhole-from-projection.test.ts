/**
 * Example and edge-case tests for `pinholeFromProjection`.
 *
 * Why this test file matters: the Recorder's COLMAP export and the Tour
 * Viewer's splat trainer reader both take their camera lens from this one
 * function. A hand-verifiable fixture points a regression at a specific
 * wrong number, and the error paths keep a malformed matrix from an
 * untrusted recording from turning into NaN intrinsics.
 */

import { describe, it, expect } from 'vitest';
import type { Matrix4 } from 'gps-plus-slam-js';

import { pinholeFromProjection } from './pinhole-from-projection';

describe('pinholeFromProjection', () => {
  it('recovers W/2, H/2 principal point from a symmetric frustum', () => {
    const W = 1280;
    const H = 960;
    // Symmetric perspective: m20 = m21 = 0, m00 = 2fx/W, m11 = 2fy/H.
    const fx = 1000;
    const fy = 1100;
    const m = new Array(16).fill(0) as number[];
    m[0] = (2 * fx) / W;
    m[5] = (2 * fy) / H;
    m[10] = -1;
    m[11] = -1;
    m[14] = -0.2;
    const intr = pinholeFromProjection(m as unknown as Matrix4, W, H);
    expect(intr.fx).toBeCloseTo(fx, 4);
    expect(intr.fy).toBeCloseTo(fy, 4);
    expect(intr.cx).toBeCloseTo(W / 2, 4);
    expect(intr.cy).toBeCloseTo(H / 2, 4);
  });

  it('uses the continuous pixel convention: no half-pixel shift', () => {
    // A centred frustum on an odd-sized frame: the continuous convention
    // gives exactly W/2 (here 205.5), the integer-centre one W/2 - 0.5.
    // A caller that adds a second convention step would shift every
    // principal point by half a pixel, which a 6 px sweep cannot see.
    const m = new Array(16).fill(0) as number[];
    m[0] = 2;
    m[5] = 1;
    const intr = pinholeFromProjection(m as unknown as Matrix4, 411, 961);
    expect(intr.cx).toBe(205.5);
    expect(intr.cy).toBe(480.5);
  });

  it('throws on a non-16-length or non-finite matrix', () => {
    expect(() =>
      pinholeFromProjection([1, 2, 3] as unknown as Matrix4, 100, 100)
    ).toThrow(RangeError);
    const bad = new Array(16).fill(0) as number[];
    bad[0] = Number.NaN;
    expect(() =>
      pinholeFromProjection(bad as unknown as Matrix4, 100, 100)
    ).toThrow(RangeError);
  });

  it('throws on non-positive width/height', () => {
    const m = new Array(16).fill(0) as number[];
    m[0] = 1.5;
    m[5] = 1.5;
    expect(() =>
      pinholeFromProjection(m as unknown as Matrix4, 0, 100)
    ).toThrow(RangeError);
    expect(() =>
      pinholeFromProjection(m as unknown as Matrix4, 100, -10)
    ).toThrow(RangeError);
  });

  it('throws when the matrix yields a non-positive focal length', () => {
    const m = new Array(16).fill(0) as number[];
    m[0] = 0; // fx = 0
    m[5] = 1.5;
    expect(() =>
      pinholeFromProjection(m as unknown as Matrix4, 100, 100)
    ).toThrow(RangeError);
  });
});
