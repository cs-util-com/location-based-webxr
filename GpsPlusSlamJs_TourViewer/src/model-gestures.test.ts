/**
 * Why these tests matter: the visitor's fingers do two jobs in AR - a tap
 * opens a note or a sheet, a pinch or a drag plays with a toy - and the
 * two must never be confused. A pinch that resized a full-scale model, or
 * a drag that moved a ghost, would put a tour's model somewhere its
 * creator never placed it. The toy's limits (0.1x-3x, never beyond 50 m)
 * keep a toy from vanishing under a finger or swallowing the street.
 */
import { describe, expect, it } from "vitest";
import { TOUR_MODEL_WORLD_VIEWS } from "gps-plus-slam-app-framework/ar/tour-blocks";

import {
  modelGestureAction,
  pinchedToyFactor,
  toyDragMetres,
  toyFactorRange,
  toyStartFactor,
} from "./model-gestures.js";

describe("modelGestureAction", () => {
  // Why: the gesture rule, for every world view a model has - a tap always
  // opens, a pinch or drag acts only on a held toy.
  it("a tap opens in every view; a pinch scales and a drag moves only a held toy", () => {
    for (const view of TOUR_MODEL_WORLD_VIEWS) {
      expect(modelGestureAction(view, "tap", false)).toBe("open");
      expect(modelGestureAction(view, "tap", true)).toBe("open");
      const toy = view === "toy";
      expect(modelGestureAction(view, "pinch", true)).toBe(
        toy ? "scale" : "none",
      );
      expect(modelGestureAction(view, "drag", true)).toBe(
        toy ? "move" : "none",
      );
      expect(modelGestureAction(view, "pinch", false)).toBe("none");
      expect(modelGestureAction(view, "drag", false)).toBe("none");
    }
  });
});

describe("the toy's size", () => {
  // Why: the cap at 50 m lowers the top of the range for a large model;
  // a small one keeps the full 0.1x-3x.
  it("ranges 0.1x-3x, the top lowered so the largest side stays within 50 m", () => {
    expect(toyFactorRange(2)).toEqual({ min: 0.1, max: 3 });
    expect(toyFactorRange(20)).toEqual({ min: 0.1, max: 2.5 });
    expect(toyFactorRange(50).max).toBe(1);
    // A tour may place a model larger than 50 m: the toy shrinks it to
    // 50 m, never below the 0.1x floor.
    expect(toyFactorRange(200).max).toBe(0.25);
    expect(toyFactorRange(1000).max).toBe(0.1);
    expect(() => toyFactorRange(0)).toThrow(RangeError);
    expect(() => toyFactorRange(Number.NaN)).toThrow(RangeError);
  });

  // Why: a toy starts at its real size at its pose, as the tour placed it
  // - unless that is beyond the cap.
  it("starts at its real size, or at 50 m for a larger model", () => {
    expect(toyStartFactor(2.7)).toBe(1);
    expect(toyStartFactor(50)).toBe(1);
    expect(toyStartFactor(100)).toBe(0.5);
  });

  // Why: a pinch follows the fingers' distance ratio and stops at the
  // limits; a broken touch (zero distance) changes nothing.
  it("follows a pinch's ratio within the limits", () => {
    expect(pinchedToyFactor(1, 100, 200, 2)).toBe(2);
    expect(pinchedToyFactor(1, 100, 50, 2)).toBe(0.5);
    expect(pinchedToyFactor(1, 100, 1000, 2)).toBe(3);
    expect(pinchedToyFactor(1, 1000, 1, 2)).toBe(0.1);
    expect(pinchedToyFactor(1, 100, 1000, 40)).toBe(1.25);
    expect(pinchedToyFactor(1.5, 0, 100, 2)).toBe(1.5);
    expect(pinchedToyFactor(1.5, 100, Number.NaN, 2)).toBe(1.5);
    expect(pinchedToyFactor(9, 100, 100, 2)).toBe(3);
  });
});

describe("toyDragMetres", () => {
  const base = {
    heightPx: 800,
    distanceM: 4,
    fovYRad: Math.PI / 2,
    yawRad: 0,
  };
  // Why: the toy follows the finger: at 4 m with a 90 degree view a
  // 800 px screen spans 8 m, so 100 px is 1 m - right is +x and up on the
  // screen is away (-z) for a camera looking along -z.
  it("moves a pixel's span at the toy's distance, right and away", () => {
    const [rx, rz] = toyDragMetres({ ...base, dxPx: 100, dyPx: 0 });
    expect(rx).toBeCloseTo(1, 12);
    expect(rz).toBeCloseTo(0, 12);
    const [ax, az] = toyDragMetres({ ...base, dxPx: 0, dyPx: -100 });
    expect(ax).toBeCloseTo(0, 12);
    expect(az).toBeCloseTo(-1, 12);
  });

  // Why: turned 90 degrees left the camera looks along -x, so its right
  // is -z and away is -x.
  it("turns with the camera", () => {
    const yaw = { ...base, yawRad: Math.PI / 2 };
    const [rx, rz] = toyDragMetres({ ...yaw, dxPx: 100, dyPx: 0 });
    expect(rx).toBeCloseTo(0, 12);
    expect(rz).toBeCloseTo(-1, 12);
    const [ax, az] = toyDragMetres({ ...yaw, dxPx: 0, dyPx: -100 });
    expect(ax).toBeCloseTo(-1, 12);
    expect(az).toBeCloseTo(0, 12);
  });

  // Why: defensive - a screen, a distance or a field of view that is not
  // usable must not throw a toy to infinity.
  it("is zero for unusable input", () => {
    for (const bad of [
      { heightPx: 0 },
      { distanceM: 0 },
      { fovYRad: 0 },
      { fovYRad: Math.PI },
      { dxPx: Number.NaN },
      { yawRad: Number.POSITIVE_INFINITY },
    ]) {
      expect(toyDragMetres({ ...base, dxPx: 10, dyPx: 10, ...bad })).toEqual([
        0, 0,
      ]);
    }
  });
});
