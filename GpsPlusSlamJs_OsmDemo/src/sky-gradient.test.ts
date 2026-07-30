/**
 * The sky ramp — the part of the background provable without a GPU.
 *
 * WHY THESE TESTS MATTER. A gradient has exactly three interesting ways to be
 * wrong, and all three look intentional on screen rather than broken: it can be
 * upside down (bright overhead, dark at the horizon — reads as a stylistic
 * choice), it can be non-monotonic (a band partway up, reads as a light source),
 * or it can be transparent (composites against the canvas clear colour and
 * quietly restores the near-black this whole change exists to remove). None of
 * those would fail the e2e pixel check, which only asserts that top and bottom
 * differ.
 */

import { describe, expect, it } from "vitest";

import {
  HORIZON_RGB,
  SKY_GRADIENT_ROWS,
  ZENITH_RGB,
  skyGradientPixels,
} from "./sky-gradient.js";

/** The RGB triple of one row. */
function rowAt(data: Uint8Array, row: number): [number, number, number] {
  return [
    data[row * 4] ?? -1,
    data[row * 4 + 1] ?? -1,
    data[row * 4 + 2] ?? -1,
  ];
}

/** Perceptual-ish brightness, enough to order two dark blues. */
const luma = ([r, g, b]: readonly [number, number, number]): number =>
  0.2126 * r + 0.7152 * g + 0.0722 * b;

describe("skyGradientPixels", () => {
  it("puts the ZENITH colour at the top and the HORIZON colour at the bottom", () => {
    // The orientation test. Reversed, the sky is bright overhead and dark at the
    // horizon — which looks deliberate, so nothing else would catch it.
    const data = skyGradientPixels();
    expect(rowAt(data, 0)).toEqual([...ZENITH_RGB]);
    expect(rowAt(data, SKY_GRADIENT_ROWS - 1)).toEqual([...HORIZON_RGB]);
  });

  it("gets monotonically brighter towards the horizon", () => {
    // A band partway up reads as a light source in the sky rather than as a
    // broken ramp, so monotonicity is asserted rather than eyeballed.
    const data = skyGradientPixels();
    let previous = -Infinity;
    for (let row = 0; row < SKY_GRADIENT_ROWS; row++) {
      const current = luma(rowAt(data, row));
      expect(current).toBeGreaterThanOrEqual(previous);
      previous = current;
    }
  });

  it("is fully opaque on every row", () => {
    // A translucent sky composites against the canvas clear colour, which is the
    // near-black this replaces — so the bug would be "the fix did nothing".
    const data = skyGradientPixels();
    for (let row = 0; row < SKY_GRADIENT_ROWS; row++) {
      expect(data[row * 4 + 3]).toBe(255);
    }
  });

  it("makes the horizon clearly lighter than the ground it meets", () => {
    // The POINT of the change (DEC-R2-2): the ground plane's far edge has to read
    // as a silhouette against sky. The ground is 0x3a4356; if the horizon were
    // not clearly lighter, the horizon would still be a seam between two darks
    // and the original complaint would stand.
    const groundLuma = luma([0x3a, 0x43, 0x56]);
    const horizonLuma = luma(HORIZON_RGB);
    expect(horizonLuma).toBeGreaterThan(groundLuma + 10);
  });

  it("sizes the buffer to the requested rows, and rejects a degenerate one", () => {
    expect(skyGradientPixels(8)).toHaveLength(8 * 4);
    // Fewer than two rows cannot interpolate; a silent single-colour "gradient"
    // would look like the flat background this replaces.
    expect(() => skyGradientPixels(1)).toThrow(RangeError);
    expect(() => skyGradientPixels(2.5)).toThrow(RangeError);
  });
});
