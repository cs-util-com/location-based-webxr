/**
 * Tests for the package's one three-argument smoothstep.
 *
 * Why this file matters: this is the TS mirror of GLSL's built-in
 * `smoothstep`, and every TS twin of a shader (the occluder fade, the
 * atmosphere haze boundary, the cloud density) is only as faithful as it.
 * GLSL clamps; forgetting to clamp overshoots outside the edges.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { smoothstep } from './smoothstep.js';

describe('smoothstep', () => {
  it('matches GLSL at the edges and the midpoint', () => {
    expect(smoothstep(2, 6, 2)).toBe(0);
    expect(smoothstep(2, 6, 6)).toBe(1);
    expect(smoothstep(2, 6, 4)).toBe(0.5);
  });

  // GLSL clamps: outside the edges the result is exactly 0 or 1.
  it('clamps outside the edges', () => {
    expect(smoothstep(2, 6, -10)).toBe(0);
    expect(smoothstep(2, 6, 100)).toBe(1);
  });

  it('is monotone and within [0, 1] between the edges', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 10, noNaN: true }),
        fc.double({ min: 0, max: 10, noNaN: true }),
        (a, b) => {
          const [lo, hi] = a < b ? [a, b] : [b, a];
          const s = smoothstep(0, 10, lo);
          expect(s).toBeGreaterThanOrEqual(0);
          expect(s).toBeLessThanOrEqual(1);
          expect(smoothstep(0, 10, hi)).toBeGreaterThanOrEqual(s);
        }
      )
    );
  });
});
