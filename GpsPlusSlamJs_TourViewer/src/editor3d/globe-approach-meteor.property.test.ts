/**
 * Why these properties matter: the approach's start must show the whole
 * Earth at whatever size the page has (a phone turned either way, a
 * window of any shape), so the derived start is checked over aspects and
 * fields of view, not at a few chosen ones: never inside the fit, never
 * nearer than the globe lab's zoom-out distance, no nearer on a narrower
 * view, and a link's startKm always taken as it is.
 */
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { GLOBE_INTRO, globeViewFitM } from "gps-plus-slam-globe/view";
import { WGS84_ELLIPSOID } from "gps-plus-slam-globe/test-utils/view-pose";

import { meteorStartAltitudeM } from "./globe-approach-meteor.js";

const RADIUS_M = WGS84_ELLIPSOID.radius.x;
const aspect = fc.double({ min: 0.25, max: 4, noNaN: true });
const fov = fc.double({ min: 20, max: 90, noNaN: true });

const derived = (a: number, fovYDeg = 50) =>
  meteorStartAltitudeM({
    radiusM: RADIUS_M,
    fovYDeg,
    aspect: a,
    startKm: null,
  });

describe("meteorStartAltitudeM", () => {
  it("is never inside twice the fit nor nearer than the lab's zoom-out", () => {
    fc.assert(
      fc.property(aspect, fov, (a, fovYDeg) => {
        const centreM = derived(a, fovYDeg) + RADIUS_M;
        const fitM = globeViewFitM({ radiusM: RADIUS_M, fovYDeg, aspect: a });
        expect(centreM).toBeGreaterThanOrEqual(2 * fitM - 1e-6);
        expect(centreM).toBeGreaterThanOrEqual(GLOBE_INTRO.maxKm * 1000);
      }),
    );
  });

  it("starts no nearer on a narrower view", () => {
    fc.assert(
      fc.property(aspect, aspect, fov, (a, b, fovYDeg) => {
        const [narrow, wide] = a < b ? [a, b] : [b, a];
        expect(derived(narrow, fovYDeg)).toBeGreaterThanOrEqual(
          derived(wide, fovYDeg) - 1e-6,
        );
      }),
    );
  });

  it("takes a link's startKm as it is", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 500, max: 65_000, noNaN: true }),
        aspect,
        (km, a) => {
          expect(
            meteorStartAltitudeM({
              radiusM: RADIUS_M,
              fovYDeg: 50,
              aspect: a,
              startKm: km,
            }),
          ).toBe(km * 1000);
        },
      ),
    );
  });

  it("reads an aspect that is not a positive number as a landscape view", () => {
    // Why: the page estimates the aspect before its box is laid out; a 0
    // or NaN estimate must not place the camera at NaN.
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const m = derived(bad);
      expect(Number.isFinite(m)).toBe(true);
      expect(m).toBe(derived(16 / 9));
    }
  });
});
