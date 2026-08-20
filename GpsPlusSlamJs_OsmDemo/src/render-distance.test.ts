import { describe, expect, it } from "vitest";
import * as fc from "fast-check";

import { MAX_RENDER_MULTIPLIER, renderDistanceFor } from "./render-distance.js";
import { FAR_PLANE_M } from "./building-view.js";
import { TERRAIN_EXTENT_M } from "./heightfield.js";

/**
 * Why these tests matter: the reporter asked for two things — "render further"
 * and "always draw the terrain profile" — and the code says they are ONE thing.
 * `building-view.ts` documents `FAR_PLANE_M === TERRAIN_EXTENT_M` as a
 * constraint rather than a coincidence: the ground plane stops at the extent, so
 * a far plane beyond it lets the view see the edge of the world, which is
 * finding R2-9 (buildings standing on nothing) returning.
 *
 * So a far-plane slider built alone would not answer the question, it would
 * demonstrate a known defect. This module is the arithmetic for one control that
 * moves both, and these tests pin the coupling so it cannot be split later by
 * someone who only reads one of the two constants (DEC-Y23).
 */

describe("renderDistanceFor", () => {
  it("is INERT at 1x — today's values, exactly", () => {
    // The instrument must change nothing until it is used. If this drifts, the
    // debug control has become a behaviour change, which DEC-Y24 forbids.
    const at1 = renderDistanceFor(1);
    expect(at1.farPlaneM).toBe(FAR_PLANE_M);
    expect(at1.terrainExtentM).toBe(TERRAIN_EXTENT_M);
  });

  it("never lets the camera see past the ground, at ANY multiplier", () => {
    // THE INVARIANT THE TWO CONSTANTS ENCODE TODAY, expressed so it survives
    // becoming runtime state. `far-field.test.ts` asserts it for the shipped
    // constants; this asserts it for every value the slider can reach.
    fc.assert(
      fc.property(
        fc.double({ min: -100, max: 100, noNaN: true }),
        (multiplier) => {
          const { farPlaneM, terrainExtentM } = renderDistanceFor(multiplier);
          expect(farPlaneM).toBeLessThanOrEqual(terrainExtentM);
        },
      ),
    );
  });

  it("scales both together, so the extra distance has ground under it", () => {
    const at4 = renderDistanceFor(4);
    expect(at4.farPlaneM).toBe(FAR_PLANE_M * 4);
    expect(at4.terrainExtentM).toBe(TERRAIN_EXTENT_M * 4);
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
      expect(renderDistanceFor(bad).terrainExtentM).toBe(TERRAIN_EXTENT_M);
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
          const { farPlaneM, terrainExtentM } = renderDistanceFor(multiplier);
          expect(Number.isFinite(farPlaneM)).toBe(true);
          expect(Number.isFinite(terrainExtentM)).toBe(true);
          expect(farPlaneM).toBeGreaterThan(0);
          expect(terrainExtentM).toBeGreaterThan(0);
        },
      ),
    );
  });
});
