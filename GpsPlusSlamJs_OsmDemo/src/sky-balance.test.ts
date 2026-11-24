import fc from "fast-check";
import { linearToSrgb, rgbToLab } from "osm-h3";
import { describe, expect, it } from "vitest";

import { hasSkyBalance, skyBalanceGain } from "./sky-balance.js";

const luminance = (g: readonly number[]) =>
  0.2126 * g[0]! + 0.7152 * g[1]! + 0.0722 * g[2]!;

/** The Lab a mid-grey (sRGB 0x777777, linear ~0.18) shows after the gain. */
function greyThrough(gain: readonly [number, number, number]) {
  const grey = 0.1845;
  const hex = gain
    .map((g) => Math.round(255 * linearToSrgb(Math.min(1, grey * g))))
    .reduce((acc, c) => (acc << 8) | c, 0);
  return rgbToLab(hex);
}

describe("skyBalanceGain (a colour cast on the sky's own light)", () => {
  // WHY: a balance of (0, 0) must leave the sky exactly as the model drew
  // it, so every look without one renders as before (and nothing re-bakes).
  it("is null for no balance", () => {
    expect(skyBalanceGain(0, 0)).toBeNull();
  });

  // WHY: the gain is a colour, not a brightness: its luminance is 1, so the
  // auto-exposure and the city's sky light keep their level and only the
  // cast moves.
  it("keeps the luminance at 1 for every balance the sliders reach", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -20, max: 20, noNaN: true }),
        fc.double({ min: -30, max: 30, noNaN: true }),
        (a, b) => {
          const g = skyBalanceGain(a, b);
          if (g === null) return;
          expect(luminance(g)).toBeCloseTo(1, 2);
          for (const c of g) expect(c).toBeGreaterThanOrEqual(0);
        },
      ),
    );
  });

  // WHY: the balance names the cast in the units the look is measured in:
  // a mid-grey sky seen through it shows about the a* and b* asked for.
  it("casts a mid grey toward the a* and b* it names", () => {
    for (const [a, b] of [
      [-12, -8],
      [0, -20],
      [10, 15],
    ] as const) {
      const lab = greyThrough(skyBalanceGain(a, b)!);
      expect(lab.l).toBeCloseTo(50, -0.5);
      expect(Math.abs(lab.a - a)).toBeLessThan(1.5);
      expect(Math.abs(lab.b - b)).toBeLessThan(1.5);
    }
  });

  // WHY: the Copy line and the gain must agree on what "a balance is set"
  // means, or the line could name a cast the sky does not draw (or hide one
  // it does). One predicate decides both; -0 is no balance, and a value
  // that is not finite counts as set, so the Copy line still names it
  // instead of the gain's RangeError deciding.
  it("has one test for a set balance, shared with the gain", () => {
    expect(hasSkyBalance(0, 0)).toBe(false);
    expect(hasSkyBalance(-0, 0)).toBe(false);
    expect(hasSkyBalance(0, 5)).toBe(true);
    expect(hasSkyBalance(-0.5, 0)).toBe(true);
    expect(hasSkyBalance(Number.NaN, 0)).toBe(true);
    fc.assert(
      fc.property(
        fc.oneof(fc.constant(0), fc.double({ min: -20, max: 20, noNaN: true })),
        fc.oneof(fc.constant(0), fc.double({ min: -30, max: 30, noNaN: true })),
        (a, b) => {
          expect(skyBalanceGain(a, b) !== null).toBe(hasSkyBalance(a, b));
        },
      ),
    );
  });

  it("refuses a balance that is not finite", () => {
    expect(() => skyBalanceGain(Number.NaN, 0)).toThrow(RangeError);
    expect(() => skyBalanceGain(0, Number.POSITIVE_INFINITY)).toThrow(
      RangeError,
    );
  });
});
