/**
 * The heat scale.
 *
 * WHY THESE TESTS MATTER MORE THAN THEY LOOK. This module is how Iteration 8
 * answers "are the unbounded thresholds practically pickable?" — and a colour
 * ramp can make that question unanswerable by accident. A linear ramp on a
 * multiplicative quantity puts one outlier at the top and everything else at
 * the bottom, so the map looks empty regardless of what the data says, and the
 * session concludes "the scores are unusable" when what was unusable was the
 * picture.
 *
 * So the tests pin the two properties that keep the picture honest: equal
 * ratios get equal colour steps, and a degenerate scale collapses to flat
 * rather than to NaN.
 */

import { describe, it, expect } from 'vitest';

import {
  describeScale,
  heatColour,
  heatFraction,
  heatScale,
  toHex,
} from './heat-colours.js';

describe('building the scale from the data', () => {
  it('uses the highest score present, so each category gets its own range', () => {
    // `walkable` in a city saturates where `restingArea` has a few cells at 6.
    // A fixed scale would render most categories uniformly dark and hide the
    // variation the session exists to judge.
    expect(heatScale([1, 5, 35], 1)).toEqual({ threshold: 1, max: 35 });
  });

  it('never drops below the threshold, even if every score is at it', () => {
    expect(heatScale([1, 1], 1).max).toBe(1);
  });

  it('ignores non-finite scores rather than propagating them', () => {
    // A NaN max would make every fraction NaN and every cell black — a total
    // blackout caused by one bad cell.
    expect(heatScale([5, Number.NaN, 10], 1).max).toBe(10);
  });
});

describe('the ramp is logarithmic, which is the point', () => {
  const scale = heatScale([100], 1);

  it('gives equal RATIOS equal steps', () => {
    // 1 -> 10 -> 100 is two equal ratios, so it must be two equal colour steps.
    // Under a linear ramp 10 would sit at 9% and the map would look empty.
    const atTen = heatFraction(10, scale);
    const atHundred = heatFraction(100, scale);
    expect(atTen).toBeCloseTo(0.5, 6);
    expect(atHundred).toBeCloseTo(1, 6);
  });

  it('puts anything at or below the threshold off the ramp entirely', () => {
    // The identity means "no rule said anything here". Colouring it would claim
    // knowledge the data does not have.
    expect(heatFraction(1, scale)).toBe(0);
    expect(heatFraction(0.5, scale)).toBe(0);
  });

  it('clamps rather than running off the ramp', () => {
    expect(heatFraction(1000, scale)).toBe(1);
  });

  it('collapses to flat when every score is identical', () => {
    // max === threshold would divide by zero. A flat map is the correct picture
    // of flat data; NaN is a black screen with no explanation.
    const flat = heatScale([1, 1, 1], 1);
    expect(heatFraction(1, flat)).toBe(0);
    expect(Number.isNaN(heatFraction(2, flat))).toBe(false);
  });
});

describe('colours', () => {
  const scale = heatScale([100], 1);

  it('runs from the dark end to the bright end', () => {
    const low = heatColour(1.01, scale);
    const high = heatColour(100, scale);
    // Perceptually near-uniform and colour-blind safe; a rainbow ramp invents
    // banding that reads as structure in the data.
    expect(low.r + low.g + low.b).toBeLessThan(high.r + high.g + high.b);
  });

  it('produces valid hex for CSS and Leaflet', () => {
    expect(toHex(heatColour(10, scale))).toMatch(/^#[0-9a-f]{6}$/);
    expect(toHex({ r: 0, g: 0, b: 0 })).toBe('#000000');
    expect(toHex({ r: 255, g: 255, b: 255 })).toBe('#ffffff');
  });

  it('is monotonic in the score', () => {
    // A non-monotonic ramp would put a lower score at a brighter colour, which
    // is worse than no colour at all — it inverts the reading.
    const fractions = [2, 5, 20, 60, 100].map((s) => heatFraction(s, scale));
    for (let i = 1; i < fractions.length; i++) {
      expect(fractions[i]!).toBeGreaterThan(fractions[i - 1]!);
    }
  });
});

describe('describeScale', () => {
  it('states the numbers behind the picture', () => {
    // Without this the demo answers "does it look plausible?" rather than "is 1
    // really the identity here?", and only the second is worth a session.
    const text = describeScale(heatScale([35], 1));
    expect(text).toContain('1');
    expect(text).toContain('35');
    expect(text).toMatch(/identity/);
  });

  it('rounds floating-point noise at the PRESENTATION boundary', () => {
    // The multiplicative kernel produces 3.6000000000000005. Rounding here
    // keeps the oracle values exact in the model, which is where they must be.
    expect(describeScale({ threshold: 1, max: 3.6000000000000005 })).toContain(
      '3.6'
    );
  });
});

describe("a non-positive threshold from the rule table", () => {
  /**
   * WHY THIS MATTERS. Thresholds come from the live Google Sheet through
   * `toNumber`, which accepts `0` and negatives — nothing validates positivity
   * at that boundary. With `threshold = 0` the log ramp degenerates:
   * `Math.log(0)` is `-Infinity`, so `span` is `Infinity`, `at` is
   * `Infinity/Infinity` = `NaN`, and `Math.min(1, Math.max(0, NaN))` is `NaN`
   * because the clamp does not catch it. `heatColour` then indexes `RAMP[NaN]`
   * and `toHex` emits `#NaNNaNNaN`, which Leaflet takes as an invalid fill.
   *
   * The `score <= threshold` early return does NOT save it: with a threshold of
   * zero every drawn cell has a positive score, so every cell takes this path.
   * A single bad sheet edit would blank the entire map.
   */
  it("does not produce NaN for threshold 0", () => {
    const scale = heatScale([10, 35], 0);
    expect(Number.isNaN(heatFraction(10, scale))).toBe(false);
    expect(toHex(heatColour(10, scale))).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("does not produce NaN for a negative threshold", () => {
    // `Math.log` of a negative is NaN, which poisons the span directly.
    const scale = heatScale([10, 35], -5);
    expect(Number.isNaN(heatFraction(10, scale))).toBe(false);
    expect(toHex(heatColour(10, scale))).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("still renders every cell as SOMETHING rather than blanking the map", () => {
    // Degrading to the bottom of the ramp is a defensible answer for a
    // degenerate scale; an invalid fill string is not, because Leaflet drops
    // the path entirely and the map looks like there is no data.
    const scale = heatScale([1, 10, 100], 0);
    for (const score of [1, 10, 100]) {
      expect(toHex(heatColour(score, scale))).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});
