/**
 * Why this test matters: the fold replaces `Math.min(...xs)` and
 * `Math.max(...xs)` at call sites that relied on their exact answers, so it
 * must equal them for every list the spread can take, NaN and -0 included.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { minMaxOf } from "./min-max.js";

describe("minMaxOf (property)", () => {
  it("equals the spread for every list the spread can take", () => {
    fc.assert(
      fc.property(
        fc.array(fc.oneof(fc.double(), fc.constantFrom(0, -0, Number.NaN))),
        (values) => {
          const [min, max] = minMaxOf(values);
          expect(Object.is(min, Math.min(...values))).toBe(true);
          expect(Object.is(max, Math.max(...values))).toBe(true);
        },
      ),
    );
  });
});
