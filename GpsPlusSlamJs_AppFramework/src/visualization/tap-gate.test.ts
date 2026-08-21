import { describe, expect, it } from 'vitest';

import { isTap, type PointerSample } from './tap-gate.js';

/**
 * Why these tests matter: this predicate is the only thing standing between an
 * OrbitControls camera-drag and a phantom billboard click. The thresholds are
 * behaviour, not implementation detail — a change to them changes how every
 * component's picking feels — so they are pinned here, including the inclusive
 * boundaries.
 */

const at = (x: number, y: number, timeMs: number): PointerSample => ({
  x,
  y,
  timeMs,
});

describe('isTap', () => {
  it('accepts a quick, still press', () => {
    expect(isTap(at(100, 100, 0), at(101, 101, 120))).toBe(true);
  });

  it('accepts exactly the boundary (5 px moved, 400 ms held)', () => {
    expect(isTap(at(100, 100, 0), at(103, 104, 400))).toBe(true); // 3-4-5
  });

  it('rejects a drag (moved beyond the tolerance)', () => {
    expect(isTap(at(100, 100, 0), at(110, 100, 120))).toBe(false);
  });

  it('rejects a long-press (held beyond the limit)', () => {
    expect(isTap(at(100, 100, 0), at(100, 100, 401))).toBe(false);
  });
});
