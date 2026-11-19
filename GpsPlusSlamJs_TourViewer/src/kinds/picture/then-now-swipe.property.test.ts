/**
 * Why these properties matter: wherever the screen sits and however wide
 * it is, the line must follow the finger (never jump back as it moves
 * right), stay where the visitor can still reach its knob, and stand
 * exactly under the finger inside that reach.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  SWIPE_SPLIT_MAX,
  SWIPE_SPLIT_MIN,
  swipeSplitAt,
} from "./then-now-swipe.js";

const left = fc.double({ min: -2000, max: 2000, noNaN: true });
const width = fc.double({ min: 1, max: 4000, noNaN: true });
const x = fc.double({ min: -10000, max: 10000, noNaN: true });

describe("swipeSplitAt", () => {
  it("stays within reach and follows the finger", () => {
    fc.assert(
      fc.property(left, width, x, x, (l, w, a, b) => {
        const near = swipeSplitAt(Math.min(a, b), l, w);
        const far = swipeSplitAt(Math.max(a, b), l, w);
        expect(near).toBeGreaterThanOrEqual(SWIPE_SPLIT_MIN);
        expect(far).toBeLessThanOrEqual(SWIPE_SPLIT_MAX);
        expect(near).toBeLessThanOrEqual(far);
      }),
    );
  });

  it("stands under the finger within its reach", () => {
    const share = fc.double({
      min: SWIPE_SPLIT_MIN,
      max: SWIPE_SPLIT_MAX,
      noNaN: true,
    });
    fc.assert(
      fc.property(left, width, share, (l, w, s) => {
        const at = l + s * w;
        expect(swipeSplitAt(at, l, w)).toBeCloseTo((at - l) / w, 12);
      }),
    );
  });

  it("reads the same share wherever the screen sits", () => {
    fc.assert(
      fc.property(left, width, x, left, (l, w, a, shift) => {
        expect(swipeSplitAt(a + shift, l + shift, w)).toBeCloseTo(
          swipeSplitAt(a, l, w),
          9,
        );
      }),
    );
  });
});
