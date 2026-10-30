import { describe, expect, it } from "vitest";

import { CHECK_CHARACTER, checkFovDeg } from "./character-views-check.js";

describe("the character check page's numbers", () => {
  // Why: the side-by-side with the prototype only means something when
  // both cameras see the same; the prototype's rule is "the short side
  // sees 40 degrees", so a portrait phone's vertical field is wider.
  it("gives the short side 40 degrees, as the prototype does", () => {
    expect(checkFovDeg(1440, 900)).toBe(40);
    expect(checkFovDeg(844, 390)).toBe(40);
    const tall = checkFovDeg(390, 844);
    const horizontal =
      (2 * Math.atan(Math.tan((tall * Math.PI) / 360) * (390 / 844)) * 180) /
      Math.PI;
    expect(horizontal).toBeCloseTo(40, 6);
    expect(tall).toBeGreaterThan(70);
  });

  // Why: a page sized 0 (hidden, before layout) must not hand three.js
  // a NaN field of view.
  it("falls back to 40 degrees for an unsized page", () => {
    expect(checkFovDeg(0, 0)).toBe(40);
    expect(checkFovDeg(Number.NaN, 800)).toBe(40);
  });

  // Why: the eye is the prototype's own viewpoint for station 1: 4.8 m
  // from him, on the line toward the visitor's start (0, 26).
  it("stands the eye 4.8 m from him, toward the visitor's start", () => {
    const [ex, ez] = CHECK_CHARACTER.eye;
    const [cx, cz] = CHECK_CHARACTER.at;
    expect(Math.hypot(ex - cx, ez - cz)).toBeCloseTo(4.8, 3);
    const along = Math.atan2(ex - cx, ez - cz);
    expect(along).toBeCloseTo(Math.atan2(0 - cx, 26 - cz), 3);
  });
});
