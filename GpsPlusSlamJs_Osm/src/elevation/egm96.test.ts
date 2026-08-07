/**
 * The vendored EGM96 grid, pinned against exact reference evaluations.
 *
 * WHY THIS TEST IS THE POINT OF THE WHOLE FILE. `geoid.ts` originally shipped no
 * undulation data at all, on the grounds that a plausible-but-wrong geoid is a
 * smooth, confident, tens-of-metres offset that looks like a GPS+SLAM fusion bug
 * and that no test would catch. That objection is only answered if there IS such
 * a test — so this is it.
 *
 * The expected values below are **exact evaluations of the EGM96 spherical
 * harmonic series to degree 360**, produced by the reference implementation
 * already in this project (`GpsPlusSlamCs/.../GeoidHeights.cs`, MIT). They are
 * not copied from a table, not remembered, and not derived from the grid they
 * check — which is what makes this a verification rather than a tautology.
 *
 * They are also independently sanity-checkable against published EGM96 figures:
 * St. Louis at −31.6 m is the reference library's own README example, Everest at
 * −28.7 m is the value used in its published height, and Reykjavík at +66.4 m is
 * the well-known Icelandic high.
 *
 * The assertions are STATISTICAL as well as pointwise, deliberately. A grid can
 * be right at two dozen cities and wrong in the Himalaya trench; the mean and
 * max bounds are what say "and everywhere else too".
 */

import { describe, expect, it } from "vitest";

import { egm96Geoid } from "./egm96.js";
import { EGM96_GRID_COLS, EGM96_GRID_ROWS } from "./egm96-grid.js";
import { toEllipsoidal, ZERO_GEOID } from "./geoid.js";

/**
 * `[lat, lng, exact N in metres]`, from the reference evaluator.
 *
 * Chosen to span the range and the extremes: the European high the AR stack
 * actually operates in, the North American and Indian Ocean lows, the Pacific
 * and polar cases, and the four cardinal points on the equator.
 */
const REFERENCE: readonly (readonly [number, number, number])[] = [
  [50.9413, 6.9583, 46.9058], // Cologne — the stack's own operating area
  [52.52, 13.405, 39.5135], // Berlin
  [48.8566, 2.3522, 44.5265], // Paris
  [51.5074, -0.1278, 45.9642], // London
  [40.7128, -74.006, -32.761], // New York
  [38.628155, -90.220845, -31.6292], // St. Louis — the reference README's example
  [35.6762, 139.6503, 36.7906], // Tokyo
  [-33.8688, 151.2093, 22.4658], // Sydney
  [27.9881, 86.925, -28.7413], // Everest
  [64.1466, -21.9426, 66.4295], // Reykjavík — the Icelandic high
  [-15.7939, -47.8828, -12.6442], // Brasília
  [1.3521, 103.8198, 7.6554], // Singapore
  [-1.2921, 36.8219, -16.0342], // Nairobi
  [19.4326, -99.1332, -4.1103], // Mexico City
  [55.7558, 37.6173, 14.476], // Moscow
  [-22.9068, -43.1729, -5.495], // Rio de Janeiro
  [37.7749, -122.4194, -32.2336], // San Francisco
  [25.2048, 55.2708, -33.7951], // Dubai
  [59.3293, 18.0686, 23.1544], // Stockholm
  [-34.6037, -58.3816, 16.1139], // Buenos Aires
  [0, 0, 17.1616], // Gulf of Guinea
  [0, 90, -63.2356], // the Indian Ocean low — the global minimum region
  [0, 180, 21.1533], // mid-Pacific
  [0, -90, -4.2865], // Galápagos
  [89, 0, 15.452], // near the north pole
  [-89, 0, -27.8797], // near the south pole
];

describe("the vendored EGM96 grid", () => {
  const geoid = egm96Geoid();

  it("decodes to the declared shape", () => {
    // A truncated payload would interpolate smoothly over zeros — the exact
    // silent failure this area is organised around — so the decoder refuses
    // rather than degrading, and this asserts it got what it expected.
    expect(EGM96_GRID_ROWS).toBe(181);
    expect(EGM96_GRID_COLS).toBe(360);
    expect(() => egm96Geoid()).not.toThrow();
  });

  it.each(REFERENCE)(
    "is within 5.5 m of the exact value at %s, %s",
    (lat, lng, exact) => {
      // 5.5 m is the measured worst case (5.0 m over 600 random positions) plus
      // a little headroom. It is NOT a slack tolerance chosen to make the test
      // pass — it is the bound the grid resolution actually implies.
      //
      // Asserted as an explicit absolute difference rather than with
      // `toBeCloseTo`, whose `precision` argument is a decimal-places count
      // (`10**-precision / 2`) and cannot express "within 5.5 metres" at all.
      // The first draft wrote `toBeCloseTo(exact, -0.5)` meaning that, got
      // ±1.58 m, and failed on Dubai at 1.84 m — a tolerance nobody chose.
      expect(
        Math.abs(geoid.undulationMetres({ lat, lng }) - exact),
      ).toBeLessThan(5.5);
    },
  );

  it("is within 1 m on average across the reference set", () => {
    // The pointwise bound allows any single value to be 5 m out. This says the
    // grid is not systematically shifted — a constant offset would sail through
    // every individual assertion above and break every absolute height.
    const errors = REFERENCE.map(([lat, lng, exact]) =>
      Math.abs(geoid.undulationMetres({ lat, lng }) - exact),
    );
    const mean = errors.reduce((a, b) => a + b, 0) / errors.length;
    expect(mean).toBeLessThan(1);
  });

  it("is accurate to a metre where the stack actually operates", () => {
    // Cologne is where the fixtures, the recordings and the field tests are.
    // The global bound is a promise; this is the one that gets exercised.
    expect(geoid.undulationMetres({ lat: 50.9413, lng: 6.9583 })).toBeCloseTo(
      46.9058,
      0,
    );
  });

  it("spans the real global range rather than a flattened one", () => {
    // A grid that decoded as garbage, or that lost its sign, would still pass a
    // "close to zero" style check somewhere. The Indian Ocean low near -63 m and
    // the Icelandic high near +66 m are 130 m apart and both must survive.
    const low = geoid.undulationMetres({ lat: 0, lng: 90 });
    const high = geoid.undulationMetres({ lat: 64.1466, lng: -21.9426 });
    expect(low).toBeLessThan(-55);
    expect(high).toBeGreaterThan(60);
  });

  it("wraps across the antimeridian instead of clamping", () => {
    // Longitude wraps in `gridGeoid`; a grid indexed without the wrap would
    // read the wrong edge column and be quietly wrong for half the Pacific.
    const east = geoid.undulationMetres({ lat: 0, lng: 179.9 });
    const west = geoid.undulationMetres({ lat: 0, lng: -179.9 });
    expect(Math.abs(east - west)).toBeLessThan(1);
  });

  it("changes the answer that ZERO_GEOID gets wrong", () => {
    // The reason the file exists, stated as a test: at Cologne, using no geoid
    // model puts every DEM height ~47 m below where GNSS thinks it is.
    const cologne = { lat: 50.9413, lng: 6.9583 };
    const withModel = toEllipsoidal(100, cologne, geoid);
    const without = toEllipsoidal(100, cologne, ZERO_GEOID);
    expect(withModel - without).toBeCloseTo(46.9, 0);
  });
});
