/**
 * Why these tests matter: the globe draws ORTHOMETRIC heights (the relief's
 * Terrarium and Mapterhorn tiles are in national height systems) over the
 * ellipsoid, while a phone's GPS altitude, and so a tour's `alt`, is
 * ELLIPSOIDAL: about 46-50 m apart in central Europe (G0 spikes 2026-10-17,
 * Q1 "The geoid"). An item placed without the geoid floats tens of metres
 * up; one placed with the sign wrong sinks as far. These tests pin the
 * direction (drawn = ellipsoidal - N + offset), the inverse, and the
 * defensive refusals at the module's boundary.
 */
import { describe, expect, it } from "vitest";

import {
  drawnHeightM,
  ellipsoidalHeightM,
  type GlobeGeoid,
} from "./globe-heights.js";

const constant = (n: number): GlobeGeoid => ({
  id: `constant ${n}`,
  undulationMetres: () => n,
});

const MUNICH = { lat: 48.137, lng: 11.575 };

describe("drawnHeightM", () => {
  // Why: the G0 numbers, as a test. A GPS altitude of 561.68 m at
  // Marienplatz (EGM96 N 45.68 m there) is ground drawn at 516.0 m.
  it("subtracts the geoid's undulation from an ellipsoidal height", () => {
    expect(drawnHeightM(561.68, MUNICH, constant(45.68))).toBeCloseTo(516, 9);
  });

  // Why: the per-scene vertical offset (a tour's calibration against the
  // walk's floor hits) moves everything drawn by the same amount, after
  // the geoid.
  it("adds the scene's vertical offset", () => {
    expect(drawnHeightM(561.68, MUNICH, constant(45.68), -0.4)).toBeCloseTo(
      515.6,
      9,
    );
  });

  it("asks the geoid at the place given", () => {
    const asked: { lat: number; lng: number }[] = [];
    const geoid: GlobeGeoid = {
      id: "spy",
      undulationMetres: (p) => {
        asked.push(p);
        return 48;
      },
    };
    drawnHeightM(500, { lat: 47.05, lng: 8.31 }, geoid);
    expect(asked).toEqual([{ lat: 47.05, lng: 8.31 }]);
  });

  // Why (defensive): a NaN height or a geoid answering NaN must not reach
  // the scene as a NaN position, which three draws as nothing at all.
  it("refuses a non-finite height, place, offset or undulation", () => {
    const g = constant(45);
    expect(() => drawnHeightM(Number.NaN, MUNICH, g)).toThrow(RangeError);
    expect(() => drawnHeightM(500, { lat: 91, lng: 0 }, g)).toThrow(RangeError);
    expect(() => drawnHeightM(500, { lat: Number.NaN, lng: 0 }, g)).toThrow(
      RangeError,
    );
    expect(() =>
      drawnHeightM(500, { lat: 0, lng: Number.POSITIVE_INFINITY }, g),
    ).toThrow(RangeError);
    expect(() => drawnHeightM(500, MUNICH, g, Number.NaN)).toThrow(RangeError);
    expect(() => drawnHeightM(500, MUNICH, constant(Number.NaN))).toThrow(
      RangeError,
    );
  });
});

describe("ellipsoidalHeightM", () => {
  // Why: an item the editor moves on the drawn ground is SAVED as an
  // ellipsoidal height (the tour file's field); the inverse is how.
  it("adds the undulation back and removes the offset", () => {
    expect(ellipsoidalHeightM(516, MUNICH, constant(45.68))).toBeCloseTo(
      561.68,
      9,
    );
    expect(
      ellipsoidalHeightM(515.6, MUNICH, constant(45.68), -0.4),
    ).toBeCloseTo(561.68, 9);
  });

  it("refuses what drawnHeightM refuses", () => {
    expect(() => ellipsoidalHeightM(Number.NaN, MUNICH, constant(45))).toThrow(
      RangeError,
    );
    expect(() => ellipsoidalHeightM(1, MUNICH, constant(45), Infinity)).toThrow(
      RangeError,
    );
  });
});
