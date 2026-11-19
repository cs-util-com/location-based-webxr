/**
 * Why these properties matter: wherever the screen sits and however wide
 * it is, the line must follow the finger (never jump back as it moves
 * right), stay where the visitor can still reach its knob, and stand
 * exactly under the finger inside that reach.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  SWIPE_EDGE_PX,
  SWIPE_SPLIT_MAX,
  SWIPE_SPLIT_MIN,
  swipeReach,
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
    const share = fc.double({ min: 0, max: 1, noNaN: true });
    fc.assert(
      fc.property(left, width, share, (l, w, t) => {
        const [lo, hi] = swipeReach(w);
        const at = l + (lo + t * (hi - lo)) * w;
        expect(swipeSplitAt(at, l, w)).toBeCloseTo((at - l) / w, 12);
      }),
    );
  });

  it("keeps the knob's centre clear of both edges on any screen", () => {
    // Why: a knob within the system's edge strip (Android's back swipe)
    // is a back gesture, not a drag; 48 px keeps it clear, and a screen
    // narrower than two margins keeps the middle.
    fc.assert(
      fc.property(left, width, x, (l, w, a) => {
        const centre = swipeSplitAt(a, l, w) * w;
        const margin = Math.min(SWIPE_EDGE_PX, w / 2);
        expect(centre).toBeGreaterThanOrEqual(margin - 1e-9);
        expect(w - centre).toBeGreaterThanOrEqual(margin - 1e-9);
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
