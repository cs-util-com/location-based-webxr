/**
 * Why this test matters: the seam `(elapsedMs) → state` is the ONE contract
 * between the HUD's clock and whatever draws the diamond (canvas today, a
 * shader or a sprite sheet later), and it mirrors a CSS animation whose
 * numbers are tokens: the outline over 800 ms, the dot from 600 to 850 ms,
 * reduced motion complete at once. These pin the timeline's landmarks; the
 * property test pins its shape.
 *
 * @see diamond-entrance.ts.md
 */
import { describe, expect, it } from 'vitest';
import {
  DIAMOND_ENTRANCE,
  DIAMOND_ENTRANCE_SETTLED,
  computeDiamondEntrance,
} from './diamond-entrance.js';

describe('computeDiamondEntrance', () => {
  it('the constants are the CSS tokens: 800 / 600 / 250 / 850 ms and a 180 dash', () => {
    expect(DIAMOND_ENTRANCE).toEqual({
      outlineMs: 800,
      dotDelayMs: 600,
      dotMs: 250,
      totalMs: 850,
      dashLength: 180,
    });
  });

  it('starts empty: nothing drawn at t = 0, and before it (a staggered spawn)', () => {
    expect(computeDiamondEntrance(0)).toEqual({
      outline: 0,
      dot: 0,
      settled: false,
    });
    expect(computeDiamondEntrance(-120)).toEqual({
      outline: 0,
      dot: 0,
      settled: false,
    });
  });

  it('draws the outline before the dot: at 400 ms the outline is well under way and the dot absent', () => {
    const mid = computeDiamondEntrance(400);
    // ease-out at x = 0.5 is 0.839; comfortably past linear.
    expect(mid.outline).toBeCloseTo(0.839245, 4);
    expect(mid.dot).toBe(0);
    expect(mid.settled).toBe(false);
    // Just before the dot's delay it is still absent; just after, present.
    expect(computeDiamondEntrance(599.9).dot).toBe(0);
    expect(computeDiamondEntrance(610).dot).toBeGreaterThan(0);
  });

  it('is complete and settled from 850 ms on, and identical to the settled constant', () => {
    expect(computeDiamondEntrance(850)).toEqual(DIAMOND_ENTRANCE_SETTLED);
    expect(computeDiamondEntrance(5000)).toEqual(DIAMOND_ENTRANCE_SETTLED);
    expect(computeDiamondEntrance(849.9).settled).toBe(false);
  });

  it('reduced motion is the settled state at ANY time, negative included', () => {
    for (const t of [-500, 0, 300, 850, 10_000]) {
      expect(computeDiamondEntrance(t, { reducedMotion: true })).toBe(
        DIAMOND_ENTRANCE_SETTLED
      );
    }
  });

  it('rejects a non-finite time: a NaN clock must not read as "settled" or as "start"', () => {
    expect(() => computeDiamondEntrance(Number.NaN)).toThrow(RangeError);
    expect(() => computeDiamondEntrance(Number.POSITIVE_INFINITY)).toThrow(
      RangeError
    );
  });
});
