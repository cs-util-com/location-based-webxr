import { describe, expect, it } from "vitest";

import { FETCH_SLACK, terrainWindowFor } from "./terrain-window.js";

const COLOGNE = { lat: 50.9413, lng: 6.9583 };
/** ~110 m north and ~70 m east of Cologne — one ordinary walk, no re-anchor. */
const A_STEP_AWAY = { lat: 50.9423, lng: 6.9593 };
/** A fixed thing in the world. Its ENU is what must not move. */
const A_LANDMARK = { lat: 50.9433, lng: 6.9603 };

const EXTENT_M = 2400;

describe("terrainWindowFor", () => {
  it("puts the grid in the SCENE's frame, not the user's", () => {
    // WHY THIS TEST MATTERS. This is the regression guard for the defect §5A
    // left behind: the buildings were moved into the fixed frame while the
    // heightfield was still sampled in a frame anchored on the user, so the
    // ground slid under the city by the step distance on every step. Nothing
    // detected it, because the walk test asserts on the frame origin that is
    // SENT rather than on the frames the two subsystems actually use.
    const before = terrainWindowFor({
      frameOrigin: COLOGNE,
      centre: COLOGNE,
      extentM: EXTENT_M,
    });
    const after = terrainWindowFor({
      frameOrigin: COLOGNE,
      centre: A_STEP_AWAY,
      extentM: EXTENT_M,
    });

    // Bit-identical, not merely close: the frame is a pure function of the
    // anchor, so a step cannot perturb it even in the last place of the mantissa.
    expect(after.frame.toEnu(A_LANDMARK)).toStrictEqual(
      before.frame.toEnu(A_LANDMARK),
    );
  });

  it("DOES move the frame when the anchor moves — the counterweight", () => {
    // WHY THIS TEST MATTERS. Without it, "the frame never moves" would also pass
    // for an implementation that ignored its inputs entirely. A re-anchor is a
    // real event (DEC-R11-7) and must reach the frame.
    const here = terrainWindowFor({
      frameOrigin: COLOGNE,
      centre: COLOGNE,
      extentM: EXTENT_M,
    });
    const reanchored = terrainWindowFor({
      frameOrigin: A_STEP_AWAY,
      centre: A_STEP_AWAY,
      extentM: EXTENT_M,
    });

    expect(reanchored.frame.toEnu(A_LANDMARK)).not.toStrictEqual(
      here.frame.toEnu(A_LANDMARK),
    );
  });

  it("fetches far enough to cover every corner of the sampled square", () => {
    // WHY THIS TEST MATTERS. Fetch centre and sample centre used to be the same
    // variable, so nothing could disagree. Once they are separate values, a
    // sampled post outside the fetched lattice is not an error — it is
    // mean-filled, which draws a flat plateau where real relief exists with
    // nothing reported anywhere. This is the assertion that keeps them pinned.
    //
    // PER AXIS, NOT AS A DISTANCE, because `ensureAround` builds a SQUARE
    // lattice of half-width `radiusM` — it is not a disc. Asserting a
    // great-circle distance here would demand a sqrt(2) over-fetch and
    // reintroduce a measured regression: at the 2 400 m extent that put the
    // lattice at ~321 000 posts against a 250 000 cap, so eviction ran on every
    // load and threw away posts the next load immediately re-fetched.
    const window = terrainWindowFor({
      frameOrigin: COLOGNE,
      centre: A_STEP_AWAY,
      extentM: EXTENT_M,
    });

    // The sampled square's real corners, against the fetch centre, both
    // measured in the window's own frame — so this stays an assertion about the
    // two centres agreeing rather than about either one's value.
    const fetchCentreEnu = window.frame.toEnu(window.fetchCentre);
    for (const dx of [-EXTENT_M, EXTENT_M]) {
      for (const dy of [-EXTENT_M, EXTENT_M]) {
        const corner = {
          x: window.sampleCentreEnu.x + dx,
          y: window.sampleCentreEnu.y + dy,
        };
        expect(Math.abs(corner.x - fetchCentreEnu.x)).toBeLessThanOrEqual(
          window.fetchRadiusM,
        );
        expect(Math.abs(corner.y - fetchCentreEnu.y)).toBeLessThanOrEqual(
          window.fetchRadiusM,
        );
      }
    }
  });

  it("moves the sampled window to the USER while the frame stays put", () => {
    // WHY THIS TEST MATTERS. This is the counterweight to "the frame never
    // moves": a window that also never moved would satisfy that invariant and
    // stop covering the ground the user stands on as soon as they walked
    // `extentM` from where the session started — at which point `surfaceHeight`
    // clamps, and its per-axis clamp extrudes the edge profile outward as
    // stripes that look like terrain and are not (finding R2-9).
    const here = terrainWindowFor({
      frameOrigin: COLOGNE,
      centre: COLOGNE,
      extentM: EXTENT_M,
    });
    const stepped = terrainWindowFor({
      frameOrigin: COLOGNE,
      centre: A_STEP_AWAY,
      extentM: EXTENT_M,
    });

    expect(here.sampleCentreEnu.x).toBeCloseTo(0, 9);
    expect(here.sampleCentreEnu.y).toBeCloseTo(0, 9);
    // ~110 m north and ~70 m east, expressed in the SAME frame both times.
    expect(stepped.sampleCentreEnu.y).toBeGreaterThan(100);
    expect(stepped.sampleCentreEnu.x).toBeGreaterThan(50);
    // Exactly where the frame says the user is — not an independent derivation
    // that could drift from the one the rest of the scene uses.
    expect(stepped.sampleCentreEnu).toStrictEqual(
      stepped.frame.toEnu(A_STEP_AWAY),
    );
  });

  it("keeps the fetch radius proportional to the extent", () => {
    // The slack is real, not decorative: the lattice is built on Mercator pixel
    // indices whose pitch changes slightly across the square, and the bilinear
    // read at the very edge needs a post beyond it. It is NOT a sqrt(2) margin —
    // see the corner test above for why that distinction is expensive.
    const window = terrainWindowFor({
      frameOrigin: COLOGNE,
      centre: COLOGNE,
      extentM: EXTENT_M,
    });
    expect(window.fetchRadiusM).toBeCloseTo(EXTENT_M * FETCH_SLACK);
  });

  it("throws on a non-finite anchor rather than poisoning the frame", () => {
    // WHY THIS TEST MATTERS. A NaN anchor makes every ENU coordinate in the
    // scene NaN, and NaN geometry drops triangles silently instead of reporting
    // anything — so the failure surfaces as "the city did not draw" a long way
    // from its cause. `nextAnchor` throws for the same reason.
    expect(() =>
      terrainWindowFor({
        frameOrigin: { lat: Number.NaN, lng: 6.9583 },
        centre: COLOGNE,
        extentM: EXTENT_M,
      }),
    ).toThrow(RangeError);
    expect(() =>
      terrainWindowFor({
        frameOrigin: COLOGNE,
        centre: COLOGNE,
        extentM: Number.POSITIVE_INFINITY,
      }),
    ).toThrow(RangeError);
  });
});
