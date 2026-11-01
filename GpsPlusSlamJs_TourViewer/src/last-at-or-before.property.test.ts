/**
 * Why this test matters: the voice's segment, the sentence and the caption
 * word the read-along marks are all found by this one search, every
 * frame. Checked against a linear scan for any sorted keys (repeats
 * included) and any value (before, between, on, after the keys, NaN and
 * the infinities), an off-by-one at a tie or an edge cannot pass.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { lastAtOrBefore } from "./last-at-or-before.js";

/** The reference: the last index whose key is `<= x`, or -1. */
function linear(keys: readonly number[], x: number): number {
  let found = -1;
  keys.forEach((k, i) => {
    if (k <= x) found = i;
  });
  return found;
}

describe("the last element at or before a value", () => {
  it("finds what a linear scan finds, for any sorted keys and any value", () => {
    fc.assert(
      fc.property(
        fc
          .array(fc.integer({ min: -50, max: 50 }), {
            maxLength: 40,
            size: "max",
          })
          .map((keys) => [...keys].sort((a, b) => a - b)),
        fc.oneof(
          fc.integer({ min: -60, max: 60 }),
          fc.double({ min: -60, max: 60, noNaN: true }),
          fc.constantFrom(Number.NaN, Infinity, -Infinity),
        ),
        (keys, x) => {
          const items = keys.map((at) => ({ at }));
          expect(lastAtOrBefore(items, (i) => i.at, x)).toBe(linear(keys, x));
        },
      ),
      { numRuns: 1000 },
    );
  });

  it("gives -1 for an empty list and for a value before every key", () => {
    expect(lastAtOrBefore([], (n: number) => n, 5)).toBe(-1);
    expect(lastAtOrBefore([3, 4], (n) => n, 2)).toBe(-1);
    expect(lastAtOrBefore([3, 3, 3], (n) => n, 3)).toBe(2);
  });
});
