/**
 * Geoid conversion.
 *
 * WHY THESE TESTS MATTER, and they matter more than their size suggests.
 *
 * The geoid correction is the one place in this package where being wrong
 * produces a smooth, confident, entirely plausible answer that is tens of
 * metres off — and where the symptom (a consistent vertical offset) points at
 * the GPS+SLAM fusion rather than at this file. So the tests pin the DIRECTION
 * of the conversion, the round trip, and above all the fact that the default
 * model applies no correction and says so.
 *
 * There is no "the undulation at Cologne is 47 m" test here, deliberately: this
 * package ships no undulation data (see `geoid.ts` for why), so such a test
 * would only be asserting a number the test itself supplied.
 */

import { describe, expect, it } from "vitest";

import {
  ZERO_GEOID,
  constantGeoid,
  describeGeoid,
  gridGeoid,
  toEllipsoidal,
  toOrthometric,
} from "./geoid.js";

const COLOGNE = { lat: 50.94, lng: 6.96 };

describe("the direction of the conversion", () => {
  // ellipsoidal = orthometric + N. Getting this backwards is a 2N error —
  // ~90 m in central Europe — and it looks exactly like a fusion bug.
  const geoid = constantGeoid(47);

  it("adds the undulation going from DEM height to GNSS height", () => {
    expect(toEllipsoidal(100, COLOGNE, geoid)).toBe(147);
  });

  it("subtracts it going the other way", () => {
    expect(toOrthometric(147, COLOGNE, geoid)).toBe(100);
  });

  it("round-trips exactly", () => {
    expect(
      toOrthometric(toEllipsoidal(63.5, COLOGNE, geoid), COLOGNE, geoid),
    ).toBe(63.5);
  });
});

describe("the default model", () => {
  it("applies NO correction", () => {
    expect(ZERO_GEOID.undulationMetres(COLOGNE)).toBe(0);
    expect(toEllipsoidal(100, COLOGNE, ZERO_GEOID)).toBe(100);
  });

  it("says out loud that it is wrong", () => {
    // The dangerous state is ZERO_GEOID still in place in a build that renders
    // absolute heights, and it is invisible by construction. Something has to
    // be able to say it, so an app can show it rather than discover it.
    expect(describeGeoid(ZERO_GEOID)).toMatch(/tens of metres/);
    expect(describeGeoid(constantGeoid(47))).not.toMatch(/tens of metres/);
  });
});

describe("constantGeoid", () => {
  it("is the same everywhere, which is the point", () => {
    // N varies ~1 m per 100 km in mid-latitudes, so one value is accurate to
    // centimetres across a city — far below the DEM's own ~30 m posting.
    const geoid = constantGeoid(47);
    expect(geoid.undulationMetres({ lat: 50.9, lng: 6.9 })).toBe(47);
    expect(geoid.undulationMetres({ lat: -33.9, lng: 151.2 })).toBe(47);
  });

  it("rejects a non-finite undulation at construction", () => {
    expect(() => constantGeoid(Number.NaN)).toThrow(TypeError);
  });
});

describe("gridGeoid", () => {
  /** A 2×2 grid over 10° covering 50–60°N, 0–10°E. */
  const grid = {
    id: "test-grid",
    stepDeg: 10,
    northLat: 60,
    westLng: 0,
    rows: 2,
    cols: 2,
    values: [10, 20, 30, 40],
  };

  it("returns the corner values exactly", () => {
    const geoid = gridGeoid(grid);
    expect(geoid.undulationMetres({ lat: 60, lng: 0 })).toBe(10);
    expect(geoid.undulationMetres({ lat: 60, lng: 10 })).toBe(20);
    expect(geoid.undulationMetres({ lat: 50, lng: 0 })).toBe(30);
  });

  it("interpolates bilinearly in between", () => {
    const geoid = gridGeoid(grid);
    expect(geoid.undulationMetres({ lat: 55, lng: 5 })).toBe(25);
  });

  it("rejects a grid whose values do not match its shape", () => {
    // A length mismatch would otherwise read zeros off the end and produce a
    // smoothly wrong field — the exact failure this whole file is organised
    // around, and one no downstream test could distinguish from real data.
    expect(() => gridGeoid({ ...grid, values: [1, 2, 3] })).toThrow(
      /3 values but 2×2/,
    );
  });

  it("rejects a degenerate grid", () => {
    expect(() => gridGeoid({ ...grid, rows: 1 })).toThrow(/at least 2 rows/);
    expect(() => gridGeoid({ ...grid, stepDeg: 0 })).toThrow(/positive step/);
  });

  it("clamps latitude", () => {
    const geoid = gridGeoid(grid);
    // Above the grid's north edge clamps to the top row rather than NaN.
    expect(geoid.undulationMetres({ lat: 80, lng: 0 })).toBe(10);
  });

  it("wraps longitude only when the grid spans the full 360°", () => {
    // Why this matters: an unconditional wrap makes a REGIONAL grid answer a
    // query outside its span by reading an interior column — no NaN, no throw,
    // just a smooth plausible offset. That is the exact failure mode this file
    // is organised around, and it presents as a GPS+SLAM fusion bug.
    const global = gridGeoid({
      id: "global",
      stepDeg: 90,
      northLat: 90,
      westLng: -180,
      rows: 2,
      cols: 4,
      values: [1, 2, 3, 4, 5, 6, 7, 8],
    });
    // 180°E is the same meridian as -180°, so it must read column 0.
    expect(global.undulationMetres({ lat: 90, lng: 180 })).toBe(1);
    expect(global.undulationMetres({ lat: 90, lng: -180 })).toBe(1);

    // The 2×2 test grid spans 0–10°E only, so 25°E is off its east edge and
    // must degrade to the edge value — which is what the docstring promises.
    const regional = gridGeoid(grid);
    expect(regional.undulationMetres({ lat: 60, lng: 25 })).toBe(20);
    expect(regional.undulationMetres({ lat: 60, lng: -25 })).toBe(10);
  });
});
