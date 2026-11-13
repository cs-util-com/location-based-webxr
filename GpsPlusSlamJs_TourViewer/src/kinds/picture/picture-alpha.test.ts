/**
 * Why these tests matter: the editor warns a creator who picks the
 * cut-out view for a picture with no see-through parts (it would stand as
 * a rectangle). The warning must come for an opaque picture, also one
 * whose encoder left a few soft edge pixels, and never for a real
 * cut-out, also one whose background is a small part of it.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  hasSeeThrough,
  SEE_THROUGH_BELOW,
  SEE_THROUGH_SHARE,
} from "./picture-alpha.js";

/** `n` pixels, the first `clear` of them with alpha `alpha`, the rest
 *  opaque. */
function pixels(n: number, clear: number, alpha = 0): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(n * 4).fill(255);
  for (let i = 0; i < clear; i++) rgba[i * 4 + 3] = alpha;
  return rgba;
}

describe("hasSeeThrough", () => {
  it("says no for an opaque picture and for none", () => {
    expect(hasSeeThrough(pixels(400, 0))).toBe(false);
    expect(hasSeeThrough(new Uint8ClampedArray(0))).toBe(false);
  });

  it("says yes for a picture with a see-through background", () => {
    expect(hasSeeThrough(pixels(400, 200))).toBe(true);
  });

  it("ignores a stray few clear pixels and an encoder's near-opaque edge", () => {
    // 3 of 400 is under 1 %.
    expect(hasSeeThrough(pixels(400, 3))).toBe(false);
    // Every pixel just under full: not see-through.
    expect(hasSeeThrough(pixels(400, 400, SEE_THROUGH_BELOW))).toBe(false);
    expect(hasSeeThrough(pixels(400, 400, SEE_THROUGH_BELOW - 1))).toBe(true);
  });

  it("flips exactly at its share, for any picture size", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 5000 }), (n) => {
        const need = Math.ceil(n * SEE_THROUGH_SHARE);
        expect(hasSeeThrough(pixels(n, need))).toBe(true);
        // n >= 1 makes need >= 1, so one pixel fewer is always below the share.
        expect(hasSeeThrough(pixels(n, need - 1))).toBe(false);
      }),
    );
  });
});
