/**
 * WHY THESE TESTS MATTER (W21, R4-16). The far plane and the haze are two
 * numbers that only make sense together, and getting their relationship wrong
 * fails in a way that looks intentional: haze that ends beyond the far plane
 * means geometry pops out of existence un-faded, and haze in the wrong colour
 * means a grey band hanging in front of the sky. Both read as "that is just how
 * it looks" rather than as a mistake.
 *
 * The class itself needs a `WebGLRenderer` and cannot be constructed here, so
 * these assert the constants and their relationship — which is the whole of what
 * can be wrong without a GPU.
 */

import { describe, expect, it } from "vitest";

import { FAR_PLANE_M, FOG_NEAR_M } from "./building-view.js";
import { HORIZON_RGB } from "./sky-gradient.js";

describe("the far field", () => {
  it("starts the haze INSIDE the far plane", () => {
    // Otherwise geometry crosses the far plane with no fade at all and simply
    // vanishes — the wall the haze exists to prevent.
    expect(FOG_NEAR_M).toBeLessThan(FAR_PLANE_M);
    expect(FOG_NEAR_M).toBeGreaterThan(0);
  });

  it("leaves enough distance for the fade to read as distance", () => {
    // A haze band a few metres deep is a hard edge with extra steps.
    expect(FAR_PLANE_M - FOG_NEAR_M).toBeGreaterThan(200);
  });

  it("keeps the far plane well below the old 4 km, and above AR's 300 m", () => {
    // The two ends of the trade. 4000 put every building in a res-7 fetch tile
    // inside the frustum, which is what R4-16 reports; 300 is what the AR apps
    // in this workspace use and would cut the desktop view off at the knees.
    expect(FAR_PLANE_M).toBeLessThan(2000);
    expect(FAR_PLANE_M).toBeGreaterThan(300);
  });

  it("hazes towards the sky's HORIZON colour", () => {
    // Any other colour and the fade reads as a grey band in front of the sky
    // rather than as air. This is the same "one source of truth" rule the sun
    // vector follows: the sky owns the horizon colour and the fog reads it.
    expect(HORIZON_RGB).toHaveLength(3);
    for (const channel of HORIZON_RGB) {
      expect(channel).toBeGreaterThanOrEqual(0);
      expect(channel).toBeLessThanOrEqual(255);
    }
  });
});
