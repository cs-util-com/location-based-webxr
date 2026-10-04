/**
 * Why this test matters: the globe is lit by the sun of a real instant, so
 * the frame conversion from "elevation and azimuth seen at 0°N 0°E" to an
 * ECEF direction must be exact on its axes (straight up is +x, the east
 * horizon +y, the north horizon +z) and must put the day side where the
 * solar geometry says it is. A sign slip here turns noon into midnight with
 * no error anywhere.
 */

import fc from "fast-check";
import type * as THREE from "three";
import { WGS84_ELLIPSOID } from "3d-tiles-renderer";
import { describe, expect, it } from "vitest";

import { sunDirectionEcef } from "./globe-sun.js";

const expectClose = (v: THREE.Vector3, x: number, y: number, z: number) => {
  expect(v.x).toBeCloseTo(x, 12);
  expect(v.y).toBeCloseTo(y, 12);
  expect(v.z).toBeCloseTo(z, 12);
};

describe("sunDirectionEcef", () => {
  it("maps the zenith and the east and north horizons at 0°N 0°E onto the ECEF axes", () => {
    const up = sunDirectionEcef(WGS84_ELLIPSOID, {
      elevationRad: Math.PI / 2,
      azimuthRad: 0,
    });
    expectClose(up, 1, 0, 0);
    expectClose(
      sunDirectionEcef(WGS84_ELLIPSOID, {
        elevationRad: 0,
        azimuthRad: Math.PI / 2,
      }),
      0,
      1,
      0,
    );
    expectClose(
      sunDirectionEcef(WGS84_ELLIPSOID, { elevationRad: 0, azimuthRad: 0 }),
      0,
      0,
      1,
    );
  });

  it("is a unit vector whose height above the horizon is the elevation", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -Math.PI / 2, max: Math.PI / 2, noNaN: true }),
        fc.double({ min: 0, max: 2 * Math.PI, noNaN: true }),
        (elevationRad, azimuthRad) => {
          const d = sunDirectionEcef(WGS84_ELLIPSOID, {
            elevationRad,
            azimuthRad,
          });
          expect(d.length()).toBeCloseTo(1, 12);
          // The local up at 0°N 0°E is +x.
          expect(d.x).toBeCloseTo(Math.sin(elevationRad), 12);
        },
      ),
    );
  });

  it("refuses a non-finite angle", () => {
    for (const bad of [
      { elevationRad: Number.NaN, azimuthRad: 0 },
      { elevationRad: 0, azimuthRad: Number.POSITIVE_INFINITY },
    ]) {
      expect(() => sunDirectionEcef(WGS84_ELLIPSOID, bad)).toThrow(RangeError);
    }
  });
});
