/**
 * Tests for the light dialog's readouts (plan 2026-09-24-2140).
 *
 * Why this file matters: the owner tunes by these two numbers, and a
 * readout that counted the wrong pixels would steer him wrong while looking
 * plausible. Each measure is checked on a synthetic frame whose answer is
 * known by construction.
 */
import { describe, expect, it } from "vitest";

import { litSurfaceLuma, meanChroma } from "./light-readouts.js";

const frame = (pixels: readonly [number, number, number][]) =>
  Uint8Array.from(pixels.flatMap(([r, g, b]) => [r, g, b, 255]));

describe("litSurfaceLuma", () => {
  // WHY: only warm, low-saturation pixels are lit neutral surfaces. A blue
  // sky pixel (b > r), a saturated heat-grid pixel (chroma 60 and up) and a
  // warm grey must be told apart exactly as the e2e sweep does.
  it("averages the luma of warm grey pixels only", () => {
    const grey: [number, number, number] = [200, 200, 200];
    const warm: [number, number, number] = [180, 170, 150];
    const sky: [number, number, number] = [120, 160, 220];
    const heat: [number, number, number] = [240, 120, 40];
    const luma = (p: [number, number, number]) =>
      0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2];
    expect(litSurfaceLuma(frame([grey, warm, sky, heat]))).toBeCloseTo(
      (luma(grey) + luma(warm)) / 2,
      10,
    );
    // Chroma exactly 60 is excluded, 59 included.
    expect(litSurfaceLuma(frame([[160, 130, 100]]))).toBeNaN();
    expect(litSurfaceLuma(frame([[159, 130, 100]]))).toBeCloseTo(
      luma([159, 130, 100]),
      10,
    );
    expect(litSurfaceLuma(frame([sky, heat]))).toBeNaN();
  });

  it("refuses a buffer that is not whole pixels", () => {
    expect(() => litSurfaceLuma(new Uint8Array(5))).toThrow(RangeError);
  });
});

describe("meanChroma", () => {
  // WHY: the margin is a DIFFERENCE of two of these, so the mean must be
  // over every pixel, not only the coloured ones.
  it("averages max minus min over every pixel", () => {
    expect(
      meanChroma(
        frame([
          [10, 10, 10],
          [200, 50, 100],
        ]),
      ),
    ).toBe(75);
    expect(meanChroma(new Uint8Array(0))).toBeNaN();
    expect(() => meanChroma(new Uint8Array(3))).toThrow(RangeError);
  });
});
