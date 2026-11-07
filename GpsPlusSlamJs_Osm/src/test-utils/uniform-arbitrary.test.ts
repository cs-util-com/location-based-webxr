import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { uniformIn, uniformWithSeams } from "./uniform-arbitrary.js";

/** Share of `values` within `band` of `at`. */
function shareNear(values: readonly number[], at: number, band: number) {
  return values.filter((v) => Math.abs(v - at) <= band).length / values.length;
}

describe("uniformIn", () => {
  // Why this test matters: the helper exists because fc.double is not uniform
  // over its range. fc.integer is not either, by default: fast-check biases
  // it toward zero and the bounds, which put about 18 % of draws within 1e-3
  // of the two ends of (0, 180). These pin the distribution, not just the range.
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

  it("stays inside bounds that are not on the grid", () => {
    // Why this test matters: rounding the bounds to the nearest grid point
    // could step outside them. Just below the pole that drew latitude 90,
    // which h3-js treats as the pole itself.
    for (const v of fc.sample(uniformIn(89.9999986, 89.9999996), 200)) {
      expect(v).toBeGreaterThanOrEqual(89.9999986);
      expect(v).toBeLessThanOrEqual(89.9999996);
    }
    for (const v of fc.sample(uniformIn(-89.9999996, -89.9999986), 200)) {
      expect(v).toBeGreaterThanOrEqual(-89.9999996);
      expect(v).toBeLessThanOrEqual(-89.9999986);
    }
    // A range between two grid points holds no value to draw.
    expect(() => uniformIn(1e-7, 4e-7)).toThrow(RangeError);
  });
});

describe("uniformWithSeams", () => {
  // Why this test matters: a uniform draw almost never lands exactly on a
  // bound, so a property that claims coverage of the poles or the
  // antimeridian needs those values mixed back in on purpose.
  it("draws the bounds and zero exactly, and is otherwise uniform", () => {
    const values = fc.sample(uniformWithSeams(-180, 180), 5_000);
    for (const seam of [-180, 180, 0]) {
      expect(values.filter((v) => v === seam).length).toBeGreaterThan(50);
    }
    expect(values.every((v) => v >= -180 && v <= 180)).toBe(true);
    // About a tenth of the draws are seams; the rest spread evenly.
    const seams = values.filter((v) => v === -180 || v === 180 || v === 0);
    expect(seams.length / values.length).toBeLessThan(0.15);
    expect(shareNear(values, 90, 1)).toBeGreaterThan(0.002);
  });

  it("leaves zero out when the range does not contain it", () => {
    const values = fc.sample(uniformWithSeams(10, 20), 2_000);
    expect(values.includes(0)).toBe(false);
    expect(values.includes(10)).toBe(true);
    expect(values.includes(20)).toBe(true);
  });
});
