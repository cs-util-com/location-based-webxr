import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { uniformIn } from "./uniform-arbitrary.js";

/** Share of `values` within `band` of `at`. */
function shareNear(values: readonly number[], at: number, band: number) {
  return values.filter((v) => Math.abs(v - at) <= band).length / values.length;
}

describe("uniformIn", () => {
  // Why this test matters: the helper exists because fc.double is not uniform
  // over its range. fc.integer is not either, by default: fast-check biases
  // it toward zero and the bounds, which put about 18 % of draws within 1e-3
  // of the ends of (0, 180). These pin the distribution, not just the range.
  it("draws no more often at the ends than a uniform draw would", () => {
    const values = fc.sample(uniformIn(0, 180), 20_000);
    expect(shareNear(values, 0, 1e-3)).toBeLessThan(0.02);
    expect(shareNear(values, 180, 1e-3)).toBeLessThan(0.02);
  });

  it("does not crowd at zero inside a range that spans it", () => {
    const values = fc.sample(uniformIn(-60, 60), 20_000);
    expect(shareNear(values, 0, 1e-3)).toBeLessThan(0.02);
    // Each half of the range gets about half of the draws.
    const below = values.filter((v) => v < 0).length / values.length;
    expect(below).toBeGreaterThan(0.45);
    expect(below).toBeLessThan(0.55);
  });

  it("stays inside the range and rejects a bad one", () => {
    for (const v of fc.sample(uniformIn(-1.5, 2.5), 2_000)) {
      expect(v).toBeGreaterThanOrEqual(-1.5);
      expect(v).toBeLessThanOrEqual(2.5);
    }
    expect(() => uniformIn(2, 1)).toThrow(RangeError);
    expect(() => uniformIn(Number.NaN, 1)).toThrow(RangeError);
  });
});
