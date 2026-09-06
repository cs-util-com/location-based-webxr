/**
 * Why these properties matter: the drawer reads this state every animated
 * frame, so the shape of the timeline is what a consumer relies on — a
 * fraction that never goes backwards (a redraw would erase drawn outline),
 * stays inside [0, 1] (a dash offset outside the dash length wraps), and a
 * `settled` flag that flips once and stays (it is what freezes the uploads).
 *
 * @see diamond-entrance.ts.md
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  DIAMOND_ENTRANCE,
  computeDiamondEntrance,
} from './diamond-entrance.js';

const timeMs = fc.double({ min: -2000, max: 5000, noNaN: true });

describe('computeDiamondEntrance (properties)', () => {
  it('outline, dot and settled are monotone non-decreasing in time', () => {
    fc.assert(
      fc.property(timeMs, timeMs, (a, b) => {
        const [lo, hi] = a <= b ? [a, b] : [b, a];
        const early = computeDiamondEntrance(lo);
        const late = computeDiamondEntrance(hi);
        expect(late.outline).toBeGreaterThanOrEqual(early.outline - 1e-9);
        expect(late.dot).toBeGreaterThanOrEqual(early.dot - 1e-9);
        expect(Number(late.settled)).toBeGreaterThanOrEqual(
          Number(early.settled)
        );
      })
    );
  });

  it('every fraction stays in [0, 1], and the dot never leads the outline', () => {
    fc.assert(
      fc.property(timeMs, (t) => {
        const s = computeDiamondEntrance(t);
        expect(s.outline).toBeGreaterThanOrEqual(0);
        expect(s.outline).toBeLessThanOrEqual(1);
        expect(s.dot).toBeGreaterThanOrEqual(0);
        expect(s.dot).toBeLessThanOrEqual(1);
        expect(s.dot).toBeLessThanOrEqual(s.outline + 1e-9);
      })
    );
  });

  it('settled means complete: whenever settled is true both fractions are 1', () => {
    fc.assert(
      fc.property(timeMs, (t) => {
        const s = computeDiamondEntrance(t);
        // An implication, written without a branch (vitest/no-conditional-expect).
        const settledImpliesComplete =
          !s.settled ||
          (s.outline === 1 && s.dot === 1 && t >= DIAMOND_ENTRANCE.totalMs);
        expect(settledImpliesComplete).toBe(true);
      })
    );
  });

  it('reduced motion is time-independent', () => {
    fc.assert(
      fc.property(timeMs, timeMs, (a, b) => {
        expect(computeDiamondEntrance(a, { reducedMotion: true })).toEqual(
          computeDiamondEntrance(b, { reducedMotion: true })
        );
      })
    );
  });
});
