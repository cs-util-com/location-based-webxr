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

import {
  FAR_PLANE_M,
  FOG_NEAR_M,
  GROUND_SEGMENTS,
  MAX_GROUND_SEGMENTS,
  TERRAIN_SPACING_M,
} from "./building-view.js";
import { TERRAIN_EXTENT_M } from "./heightfield.js";
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

  it("never lets the DEFAULT view see past the edge of the ground (N5)", () => {
    // THE INVARIANT THAT REPLACES A HARD-CODED CEILING (W5, DEC-R5-3). This test
    // used to assert `FAR_PLANE_M < 2000` — a round-4 guard whose reasoning was
    // "4000 put every building in a res-7 fetch tile inside the frustum". W20's
    // per-chunk meshes changed that trade: the frustum now culls, so drawing
    // distance costs what is visible rather than everything fetched. What still
    // binds is the GROUND, which simply ends.
    //
    // Stated for the DEFAULT, CENTRED camera, and the precision matters because
    // the strong version is false: the plane sits at the scene origin and never
    // moves, and `MapControls` pans, so panning far enough brings the edge into
    // view at any far plane. That was already true at 1200/1400 and W5 does not
    // change it. The claim here is "the view you are given starts inside the
    // world", which is what R5-4 is actually about.
    expect(FAR_PLANE_M).toBeLessThanOrEqual(TERRAIN_EXTENT_M);
    // The lower end of the trade is unchanged: 300 is what the AR apps in this
    // workspace use and would cut the desktop view off at the knees.
    expect(FAR_PLANE_M).toBeGreaterThan(300);
  });

  it("keeps the ground plane at the DEM's own pitch (N5)", () => {
    // The second half of the same invariant, and the one that makes raising the
    // extent a real decision rather than a constant edit. `GROUND_SEGMENTS` is
    // derived from the extent and CAPPED; if the cap binds, the plane is coarser
    // than the height field and the relief R5-2 complains is invisible gets
    // quietly worse — by the change that was meant to improve the view.
    //
    // STRICTLY less than the cap, not `<=`. A cap equal to the value it bounds is
    // a ceiling only until someone nudges the extent, and the failure is silent.
    const derived = Math.round((TERRAIN_EXTENT_M * 2) / TERRAIN_SPACING_M);
    expect(derived).toBeLessThan(MAX_GROUND_SEGMENTS);
    expect(GROUND_SEGMENTS).toBe(derived);
  });

  it("hazes before the ground can run out", () => {
    // Fog that starts beyond the terrain's own edge would fade nothing: the
    // ground would already have ended in clear air. This is the specific way
    // raising the far plane alone goes wrong, and the reason DEC-R5-3 moves
    // three constants together instead of one.
    expect(FOG_NEAR_M).toBeLessThan(TERRAIN_EXTENT_M);
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
