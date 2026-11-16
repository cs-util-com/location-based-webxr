import { describe, expect, it } from "vitest";

import { labToRgb, rgbToLab } from "./cielab.js";

/**
 * WHY THESE TESTS MATTER. The palette's per-building lightness jitter is
 * stated in CIE L* (a perceptual unit), so a conversion that is off by a
 * constant or uses the wrong white would jitter by a different amount than
 * the scheme says. The reference values are the published CIE L*a*b* (D65)
 * figures for these sRGB colours, written independently of the code.
 */
describe("rgbToLab", () => {
  it.each([
    [0xffffff, 100, 0, 0],
    [0x000000, 0, 0, 0],
    [0x808080, 53.585, 0, 0],
    [0xff0000, 53.241, 80.092, 67.203],
    [0x0000ff, 32.297, 79.188, -107.86],
  ])("converts %s to the published L*a*b*", (rgb, l, a, b) => {
    const lab = rgbToLab(rgb);
    expect(lab.l).toBeCloseTo(l, 1);
    expect(lab.a).toBeCloseTo(a, 1);
    expect(lab.b).toBeCloseTo(b, 1);
  });
});

describe("labToRgb", () => {
  it("clamps a colour outside the sRGB gamut into it", () => {
    // Why: a lightness shift of a saturated colour can leave the gamut; the
    // result must still be a colour, never NaN or a value above 0xffffff.
    const rgb = labToRgb({ l: 100, a: 80, b: 80 });
    expect(Number.isInteger(rgb)).toBe(true);
    expect(rgb).toBeGreaterThanOrEqual(0);
    expect(rgb).toBeLessThanOrEqual(0xffffff);
    expect(labToRgb({ l: -20, a: 0, b: 0 })).toBe(0x000000);
    expect(labToRgb({ l: Number.NaN, a: 0, b: 0 })).toBe(0x000000);
  });
});
