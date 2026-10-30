/**
 * Why this test matters: the check page is compared side by side with the
 * narrated-text prototype, whose camera sees 42 degrees across the short
 * side in portrait and 50 degrees of height in landscape. A different field
 * of view would make every comparison differ for a reason that is not the
 * stand's.
 */
import { describe, expect, it } from "vitest";

import { lecternCheckFovDeg } from "./lectern-check.js";

describe("lecternCheckFovDeg", () => {
  it("is 50 degrees of height in landscape and on a square", () => {
    expect(lecternCheckFovDeg(1440, 900)).toBe(50);
    expect(lecternCheckFovDeg(844, 390)).toBe(50);
    expect(lecternCheckFovDeg(500, 500)).toBe(50);
  });

  it("in portrait the width sees 42 degrees, so the vertical angle grows with the height", () => {
    const fov = lecternCheckFovDeg(390, 844);
    const aspect = 390 / 844;
    const across =
      2 * Math.atan(Math.tan((fov * Math.PI) / 360) * aspect) * (180 / Math.PI);
    expect(across).toBeCloseTo(42, 9);
    expect(fov).toBeGreaterThan(50);
  });

  it("a size that is not positive reads as landscape", () => {
    expect(lecternCheckFovDeg(0, 844)).toBe(50);
    expect(lecternCheckFovDeg(390, Number.NaN)).toBe(50);
  });
});
