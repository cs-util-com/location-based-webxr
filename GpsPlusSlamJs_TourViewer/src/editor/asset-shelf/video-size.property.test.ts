/**
 * Why this property matters: the warning must depend on the rate alone -
 * a longer clip of the same quality is no worse, a bigger file of the
 * same length never warns less - and must never warn without a known
 * length, whatever the numbers.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { videoMbPerMinute, videoSizeWarning } from "./video-size.js";

const bytes = fc.double({ min: 0, max: 1e10, noNaN: true });
const seconds = fc.double({ min: 0.01, max: 1e5, noNaN: true });
const limit = fc.double({ min: 1, max: 200, noNaN: true });

describe("video-size properties", () => {
  it("never warns less for more bytes of the same length", () => {
    fc.assert(
      fc.property(bytes, bytes, seconds, limit, (a, b, s, l) => {
        const [small, big] = a <= b ? [a, b] : [b, a];
        const smallWarns = videoSizeWarning(small, s, l) !== null;
        const bigWarns = videoSizeWarning(big, s, l) !== null;
        // The implication "small warns, so big warns", as one check.
        expect(!smallWarns || bigWarns).toBe(true);
      }),
    );
  });

  it("depends on the rate only: twice the bytes over twice the length", () => {
    fc.assert(
      fc.property(bytes, seconds, (b, s) => {
        const one = videoMbPerMinute(b, s);
        const two = videoMbPerMinute(2 * b, 2 * s);
        expect(two).toBeCloseTo(one ?? Number.NaN, 6);
      }),
    );
  });

  it("never warns without a known length", () => {
    fc.assert(
      fc.property(
        bytes,
        fc.constantFrom(0, -1, Number.NaN, Number.POSITIVE_INFINITY),
        (b, s) => {
          expect(videoSizeWarning(b, s, 1)).toBeNull();
        },
      ),
    );
  });
});
