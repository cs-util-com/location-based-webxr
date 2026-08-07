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
  groundPositionFor,
  MAX_GROUND_SEGMENTS,
  TERRAIN_SPACING_M,
} from "./building-view.js";
import { TERRAIN_EXTENT_M } from "./heightfield.js";
import { FOG_RGB } from "./sky-rig.js";

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
    // RE-EXPRESSED AGAINST THE CAMERA, NOT THE ORIGIN (round 5B). The comparison
    // is unchanged, but what it MEANS was not: while the plane sat permanently
    // at the scene origin, "the ground reaches as far as the camera can see" and
    // "the extent is at least the far plane" were only the same statement
    // because the camera sat at the origin too. Once the frame was fixed and the
    // user could walk away from it, this assertion would have kept passing while
    // the invariant it names was false — the plan's example of a test that
    // passes for the wrong reason.
    //
    // What restores the equivalence is a real change rather than a rewording:
    // the ground plane now FOLLOWS the sampled window, which is centred on the
    // user, and `recentreOn` puts the orbit target on the user as well. So the
    // default view is centred on the plane's own centre again, and the distance
    // from the camera to the nearest edge is `TERRAIN_EXTENT_M`.
    //
    // Still stated for the DEFAULT, CENTRED camera: `MapControls` pans, so
    // panning far enough brings the edge into view at any far plane. The claim
    // is "the view you are given starts inside the world" (R5-4).
    expect(FAR_PLANE_M).toBeLessThanOrEqual(TERRAIN_EXTENT_M);
    // The lower end of the trade is unchanged: 300 is what the AR apps in this
    // workspace use and would cut the desktop view off at the knees.
    expect(FAR_PLANE_M).toBeGreaterThan(300);
  });

  it("keeps the ground centred on the user, which is what makes that true", () => {
    // WHY THIS TEST MATTERS. The assertion above is only about constants, and
    // constants cannot notice that the plane stopped being under the camera.
    // This is the half that can: `BuildingView.setTerrain` positions the plane at
    // the field's `centreEnu`, and the field is sampled around the user — so the
    // camera-to-edge distance stays `TERRAIN_EXTENT_M` however far the user has
    // walked from the scene anchor.
    //
    // Asserted through `groundPositionFor`, the function the view actually
    // calls, because `BuildingView` itself needs a `WebGLRenderer` that jsdom
    // cannot provide. Asserting the arithmetic inline here instead would be a
    // test that proves only its own restatement — the very failure mode this
    // case was written to remove.
    for (const walked of [0, 500, 2_400, 4_999]) {
      const centreEnu = { x: walked, y: -walked / 2 };
      const placed = groundPositionFor(centreEnu);

      // ENU (x, y) becomes scene (x, 0, -y): the plane's centre IS the window's.
      expect(placed).toEqual({ x: centreEnu.x, y: 0, z: -centreEnu.y });
      // So the camera, which `recentreOn` puts on the user, is the same distance
      // from the nearest edge however far the user has walked.
      const reach = placed.x + TERRAIN_EXTENT_M - centreEnu.x;
      expect(reach).toBe(TERRAIN_EXTENT_M);
      expect(reach).toBeGreaterThanOrEqual(FAR_PLANE_M);
    }
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
    //
    // WEAKER THAN IT WAS, AND THE GAP IS NAMED IN `sky-rig.ts`. The old sky had
    // ONE horizon colour, so a constant fog matched it exactly. The scattering
    // sky.s horizon changes with the sun, so this can now only check the value
    // is a well-formed colour. Deriving fog from the sky is a filed follow-up.
    expect(FOG_RGB).toHaveLength(3);
    for (const channel of FOG_RGB) {
      expect(channel).toBeGreaterThanOrEqual(0);
      expect(channel).toBeLessThanOrEqual(255);
    }
  });
});
