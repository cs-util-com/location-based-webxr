/**
 * The package's min and max of a list, without a spread.
 *
 * Why this test matters: `Math.min(...xs)` passes one argument per element,
 * and in Node the call overflows the stack somewhere between 100 000 and
 * 125 000 elements (measured at 50k, 100k, 125k, 150k, 200k and 500k: the
 * first two pass, the rest throw `RangeError`). A building ring or a
 * region's cells are data-sized, so the fold must answer for any length
 * and must say exactly what the spread said for every list it could take:
 * NaN poisons the result, -0 is below +0, and an empty list is
 * `[Infinity, -Infinity]`.
 */
import { describe, expect, it } from "vitest";

import { minMaxOf } from "./min-max.js";

describe("minMaxOf", () => {
  it("answers for a list far past the spread's argument limit", () => {
    const values = Array.from(
      { length: 200_000 },
      (_, i) => (i * 7919) % 200_003,
    );
    values[123_456] = -5;
    values[7] = 1e9;
    expect(minMaxOf(values)).toEqual([-5, 1e9]);
  });

  it("is [Infinity, -Infinity] for an empty list, as Math.min() and Math.max() are", () => {
    expect(minMaxOf([])).toEqual([Infinity, -Infinity]);
  });

  it("is NaN on both sides when any value is NaN", () => {
    expect(minMaxOf([1, Number.NaN, 3])).toEqual([Number.NaN, Number.NaN]);
  });

  it("orders -0 below +0", () => {
    const [min, max] = minMaxOf([0, -0]);
    expect(Object.is(min, -0)).toBe(true);
    expect(Object.is(max, 0)).toBe(true);
  });

  it("reads a typed array the same way", () => {
    expect(minMaxOf(new Float64Array([2, -1, 4]))).toEqual([-1, 4]);
  });
});
