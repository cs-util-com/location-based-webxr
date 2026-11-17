/**
 * Why these tests matter: the package's seeded generator backs looks that
 * were chosen by eye (the ambient occlusion's denoise noise, which must equal
 * the design system's look-dev copy draw for draw) and precomputed tables (the
 * live clouds' cover thresholds). A changed sequence would silently move both,
 * so the first draws are pinned to the published mulberry32 reference, and the
 * seed handling (taken as an unsigned 32-bit integer) is pinned with them.
 *
 * @see mulberry32.ts.md
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { mulberry32 } from './mulberry32.js';

describe('mulberry32', () => {
  it('draws the reference sequence for seed 1', () => {
    const next = mulberry32(1);
    expect([next(), next(), next()]).toEqual([
      0.6270739405881613, 0.002735721180215478, 0.5274470399599522,
    ]);
  });

  it('reads the seed as an unsigned 32-bit integer', () => {
    // -1 and 2^32 - 1 are the same 32 bits; a fraction is truncated.
    expect(mulberry32(-1)()).toBe(mulberry32(0xffffffff)());
    expect(mulberry32(-1)()).toBe(0.8964226141106337);
    expect(mulberry32(7.9)()).toBe(mulberry32(7)());
  });

  it('gives each call its own state', () => {
    const a = mulberry32(5);
    a();
    expect(mulberry32(5)()).not.toBe(a());
  });
});

describe('mulberry32 (properties)', () => {
  it('is deterministic per seed and stays in [0, 1)', () => {
    fc.assert(
      fc.property(fc.integer({ min: -(2 ** 31), max: 2 ** 32 - 1 }), (seed) => {
        const a = mulberry32(seed);
        const b = mulberry32(seed);
        for (let i = 0; i < 32; i++) {
          const x = a();
          expect(x).toBe(b());
          expect(x).toBeGreaterThanOrEqual(0);
          expect(x).toBeLessThan(1);
        }
      })
    );
  });
});
