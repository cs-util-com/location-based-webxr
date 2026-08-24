import { describe, expect, it } from "vitest";
import * as fc from "fast-check";

import { MAX_RENDER_MULTIPLIER, renderDistanceFor } from "./render-distance.js";
import { FAR_PLANE_M } from "./building-view.js";

/**
 * Why these tests matter: the reporter asked how much further the view could
 * draw, and this is the arithmetic behind the debug dial that answers it.
 *
 * **THE COUPLING THESE TESTS USED TO PIN IS GONE, and that is the point of
 * this paragraph.** They asserted `farPlaneM <= terrainExtentM` at every
 * multiplier, on the reasoning that a far plane past the ground plane shows
 * the void beyond it (finding R2-9). Two owner decisions on 2026-08-21
 * replaced that: empty scene past the edge is acceptable, and widening the
 * ground plane is the thing that is NOT -- it makes `surfaceHeight`'s
 * per-axis clamp extrude the edge profile outward as fabricated relief.
 *
 * So the shipped control moves the camera and the fog only, `terrainExtentM`
 * was removed, and the property that scaled it went with it rather than
 * being left to guard a relationship the product no longer has.
 */

describe("renderDistanceFor", () => {
  it("is INERT at 1x — today's values, exactly", () => {
    // The instrument must change nothing until it is used. If this drifts, the
    // debug control has become a behaviour change, which DEC-Y24 forbids.
    const at1 = renderDistanceFor(1);
    expect(at1.farPlaneM).toBe(FAR_PLANE_M);
  });

  it("scales linearly, so 4x is four times the shipped distance", () => {
    const at4 = renderDistanceFor(4);
    expect(at4.farPlaneM).toBe(FAR_PLANE_M * 4);
  });

  it("clamps to the maximum rather than trusting the caller", () => {
    // A slider is a UI control and its value arrives as a parsed string. The
    // ceiling exists because the ground plane's vertex count grows with the
    // extent, so an unbounded multiplier is an out-of-memory, not a slow frame.
    expect(renderDistanceFor(1000).farPlaneM).toBe(
      FAR_PLANE_M * MAX_RENDER_MULTIPLIER,
    );
  });

  it("treats a broken multiplier as 1x rather than propagating it", () => {
    // Defensive at the boundary: NaN reaches the camera's `far` and the plane's
    // geometry, and a NaN there renders NOTHING with no error raised — the same
    // failure shape `descentOffsetM` guards against, and just as hard to
    // attribute from a field report.
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, 0, -3]) {
      expect(renderDistanceFor(bad).farPlaneM).toBe(FAR_PLANE_M);
    }
  });

  it("is finite and positive for every input", () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.double({ min: -1e6, max: 1e6, noNaN: true }),
          fc.constant(Number.NaN),
          fc.constant(Number.POSITIVE_INFINITY),
          fc.constant(Number.NEGATIVE_INFINITY),
        ),
        (multiplier) => {
          const { farPlaneM } = renderDistanceFor(multiplier);
          expect(Number.isFinite(farPlaneM)).toBe(true);
          expect(farPlaneM).toBeGreaterThan(0);
        },
      ),
    );
  });
});
