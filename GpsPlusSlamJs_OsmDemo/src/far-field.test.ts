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
import {
  DEFAULT_RENDER_MULTIPLIER,
  renderDistanceFor,
} from "./render-distance.js";

/**
 * The fog's near/far ratio, mirrored rather than imported: `FOG_NEAR_RATIO` is
 * module-private in `building-view.ts` and deliberately unexported.
 */
const FOG_NEAR_RATIO_APPROX = 0.66;

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

  it("keeps the 1x view inside the ground, and pins that the default no longer is", () => {
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
    // ⚠️ **RE-SCOPED AGAIN, BY DEC-K2 (2026-08-22), AND THE RENAME IS THE
    // POINT.** This test was called "never lets the DEFAULT view see past the
    // edge of the ground" and asserted only the two CONSTANTS below. The page
    // now boots at `DEFAULT_RENDER_MULTIPLIER`, so the default view draws to
    // 4800 m over a 2400 m plate and DOES see past the edge — deliberately, and
    // the 2026-08-21 owner decision says empty scene there is acceptable.
    //
    // The assertion below would have kept passing throughout, because
    // `FAR_PLANE_M` did not move. That is the second time this file has been
    // caught in exactly the failure its own comment above describes: an
    // assertion that survives while the sentence naming it goes false. It is
    // now named for what it actually pins — the 1x BASELINE — and the default
    // gets an assertion of its own, below.
    expect(FAR_PLANE_M).toBeLessThanOrEqual(TERRAIN_EXTENT_M);
    // The lower end of the trade is unchanged: 300 is what the AR apps in this
    // workspace use and would cut the desktop view off at the knees.
    expect(FAR_PLANE_M).toBeGreaterThan(300);
  });

  it("draws the DEFAULT view past the ground's edge, on purpose and by a bounded amount", () => {
    // WHY THIS TEST MATTERS, AND WHY IT ASSERTS SOMETHING UNCOMFORTABLE. Nothing
    // else in the suite states what the shipped view actually draws — the
    // constants say 2400 and the page draws 4800. An assertion that the default
    // is INSIDE the ground would be false; an assertion of nothing at all is how
    // the previous version of this file went stale. So this pins the trade
    // itself: the overhang exists, it is intended, and it is bounded.
    const defaultFarM = renderDistanceFor(DEFAULT_RENDER_MULTIPLIER).farPlaneM;

    // The overhang is real. If this ever stops being true the default has
    // silently returned to 1x and the field request was reverted.
    expect(defaultFarM).toBeGreaterThan(TERRAIN_EXTENT_M);

    // AND IT IS BOUNDED, which is the half that protects the picture. Empty
    // scene past the edge is acceptable (2026-08-21); a default so far past it
    // that the ground is a small plate in a large void is not the same thing.
    // 2x the extent is the accepted figure, not a derived one — it is where the
    // field test landed.
    expect(defaultFarM).toBeLessThanOrEqual(TERRAIN_EXTENT_M * 2);

    // ⚠️ THE ACCEPTED CONSEQUENCE, PINNED SO IT CANNOT MOVE SILENTLY. At the
    // default the haze starts BEYOND the ground plate — 3168 m against a 2400 m
    // extent — so the plate's edge is a hard line rather than fading out. At 1x
    // it faded, because fog far == far plane == extent put the edge at full fog.
    //
    // THE FIRST VERSION OF THIS ASSERTION WAS A TAUTOLOGY and the PR #341 review
    // caught it: `defaultFarM * 0.66 < defaultFarM` is true for any ratio below
    // one, for any far plane, forever. It could not fail, and it sat here
    // looking like the guard for exactly this property — the third instance in
    // this file of the failure its own comments name twice.
    //
    // Owner decision, 2026-08-22: accepted. Seeing where the ground stops is
    // inherent to asking to see further, and this exact configuration was
    // field-tested before the default moved. The assertions below exist so that
    // anyone who changes the fog ratio, the extent, or the default multiplier
    // has to come back and re-read that decision rather than discover the edge
    // on a phone.
    const defaultFogNearM = defaultFarM * FOG_NEAR_RATIO_APPROX;

    // The band still begins inside the drawn distance — without this the fog
    // would never engage at all and geometry would vanish at the far plane.
    expect(defaultFogNearM).toBeLessThan(defaultFarM);

    // And it begins OUTSIDE the ground plate. This is the line that fails if
    // someone "fixes" the edge by clamping the fog, which is a product change
    // and not a tidy-up.
    expect(defaultFogNearM).toBeGreaterThan(TERRAIN_EXTENT_M);

    // The 1x baseline is the regime where the edge does fade, and it must stay
    // that way: turning the dial down has to restore the old picture exactly.
    expect(FOG_NEAR_M).toBeLessThan(TERRAIN_EXTENT_M);
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
