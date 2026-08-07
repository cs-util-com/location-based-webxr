/**
 * WHY THESE TESTS MATTER (DEC-R6b-7).
 *
 * The ground colour and the plate colour were two literals in two files with
 * nothing connecting them. Round 6 lightened the ground and left the plate
 * behind, inverting a relationship neither file mentioned — plates went from
 * ~1.6x the ground's luminance to ~0.5x it — and the sixth testing session
 * reported the result as huge black polygons on the Heidelberg hills.
 *
 * A comment saying "keep these in step" would have been read by nobody. These
 * assertions fail the gate instead.
 *
 * NOTE ON WHAT THIS DOES NOT COVER. The black polygons had a second and larger
 * cause: `plates.ts` wound its triangles so every face normal pointed DOWN, and
 * `flatShading` lit them from beneath regardless of colour. That is fixed and
 * pinned in `plates.test.ts` ("winds every triangle so its face normal points
 * UP"). Do not read a green run here as proof the plates are lit correctly —
 * these two files answer different halves of the same report.
 */

import { describe, expect, it } from "vitest";

import {
  GROUND_COLOUR,
  PLATE_COLOUR,
  chroma,
  relativeLuminance,
} from "./surface-colours.js";

describe("the ground/plate relationship", () => {
  it("keeps plates LIGHTER than the ground they lie on", () => {
    // THE INVARIANT, and the one that broke. A landuse plate is a surface
    // treatment on the terrain; darker than its surroundings reads as a hole
    // punched through the ground rather than as grass lying on it.
    expect(relativeLuminance(PLATE_COLOUR)).toBeGreaterThan(
      relativeLuminance(GROUND_COLOUR),
    );
  });

  it("holds the ratio the pair had before DEC-R6-6 moved one of them", () => {
    // ~1.57 before round 6 (plate 0x4a5468 on ground 0x3a4356); ~0.53 after, a
    // threefold swing from a change that only meant to touch the ground. The
    // band is loose enough for a deliberate re-tune and tight enough that
    // lightening one constant alone cannot pass.
    const ratio =
      relativeLuminance(PLATE_COLOUR) / relativeLuminance(GROUND_COLOUR);
    expect(ratio).toBeGreaterThan(1.3);
    expect(ratio).toBeLessThan(1.9);
  });

  it("does not let the plate re-tune raise chroma", () => {
    // DEC-R4-5: the affordance heat ramp must stay the loudest thing on screen,
    // measured as absolute chroma and gated in the e2e suite. Fixing the
    // luminance by reaching for a more saturated blue would trade one regression
    // for another, so the replacement sits BELOW the 0x4a5468 it succeeded.
    expect(chroma(PLATE_COLOUR)).toBeLessThanOrEqual(chroma(0x4a5468));
    // And comfortably under viridis, which runs 80–216.
    expect(chroma(PLATE_COLOUR)).toBeLessThan(60);
  });

  it("keeps both colours neutral, as DEC-R6-6 asked of the ground", () => {
    // The slope tint needs somewhere to show rather than fighting a blue base;
    // that argument applies to the plates lying on it just as much.
    expect(chroma(GROUND_COLOUR)).toBeLessThan(40);
    expect(chroma(PLATE_COLOUR)).toBeLessThan(40);
  });
});

describe("relativeLuminance", () => {
  it("matches the WCAG anchors, so the assertions above mean something", () => {
    // A helper that agreed with itself but not with the standard would let the
    // ratio test pass on arbitrary colours.
    expect(relativeLuminance(0x000000)).toBeCloseTo(0, 6);
    expect(relativeLuminance(0xffffff)).toBeCloseTo(1, 6);
    // Mid grey is ~0.216, not 0.5 — the sRGB transfer curve is the whole reason
    // this cannot be done on raw channel values.
    expect(relativeLuminance(0x808080)).toBeCloseTo(0.2159, 3);
  });

  it("orders greys monotonically", () => {
    expect(relativeLuminance(0x333333)).toBeLessThan(
      relativeLuminance(0x999999),
    );
  });
});

describe("chroma", () => {
  it("is zero for any grey and positive for anything tinted", () => {
    expect(chroma(0x000000)).toBe(0);
    expect(chroma(0x7f7f7f)).toBe(0);
    expect(chroma(0xffffff)).toBe(0);
    expect(chroma(0x0000ff)).toBe(255);
  });
});
