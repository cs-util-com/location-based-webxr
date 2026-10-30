/**
 * Why these tests matter: the layer's promise is that the tour stays at
 * its place on the Earth across any recentre of the globe's frame,
 * anywhere on Earth, at any height a tour can have. These check it for
 * random tour centres, points of the tour's frame and pairs of frames,
 * against the tour's ECEF points written out by hand (not the library the
 * layer is built on).
 *
 * Parameter: the tolerance on a point's world position. Declared 1 mm (the
 * bound GV0 set for rendered error); the test also measures the largest
 * error over a fixed sample and checks it stays below every value of a
 * sweep from 1 mm down to 1e-6 m. In doubles the error is about 1e-9 m;
 * what fails is a float32 path: the tour frame's matrix holds an ECEF
 * translation of about 6,400 km, and a float32 copy of it (as a buffer of
 * ECEF positions would keep it) errs by tens of centimetres - checked
 * below, so the reason for the design is executable. (three composes the
 * model-view matrix in doubles and uploads only that camera-relative
 * product.)
 */
import fc from "fast-check";
import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { createGlobeLayer } from "./globe-layer.js";
import {
  earthAt,
  ecefOfTourPoint,
  recentre,
} from "../test-support/tour-frame-points.js";
import { WGS84_TEXTBOOK } from "../test-support/wgs84-textbook.js";

const TOLERANCES_M = [1e-3, 1e-4, 1e-5, 1e-6];

const latLng = fc.record({
  lat: fc.double({ min: -80, max: 80, noNaN: true }),
  lng: fc.double({ min: -180, max: 180, noNaN: true }),
});
/** A station within 5 km of the tour's centre, at any tour height. */
const tourPoint = fc.tuple(
  fc.double({ min: -5_000, max: 5_000, noNaN: true }),
  fc.double({ min: -100, max: 9_000, noNaN: true }),
  fc.double({ min: -5_000, max: 5_000, noNaN: true }),
);

/**
 * The error (m) of a tour point's world position against the globe's
 * frame times its ECEF point, mounted under the frame at `first` and read
 * after a recentre at `second`.
 */
function worldErrorM(
  centre: { lat: number; lng: number },
  [x, y, z]: readonly [number, number, number],
  first: { lat: number; lng: number },
  second: { lat: number; lng: number },
  float32 = false,
): number {
  const earth = earthAt(first);
  const tour = createGlobeLayer(earth).mountTour(WGS84_TEXTBOOK, centre);
  recentre(earth, second);
  const own = tour.frame.matrix.clone();
  if (float32) own.fromArray(Float32Array.from(own.elements));
  const point = new THREE.Vector3(x, y, z);
  const world = point
    .clone()
    .applyMatrix4(new THREE.Matrix4().multiplyMatrices(earth.matrix, own));
  const expected = ecefOfTourPoint(centre, point).applyMatrix4(earth.matrix);
  return world.distanceTo(expected);
}

describe("the tour's frame on the globe, for any place and frames", () => {
  it("keeps a tour point within 1 mm across any recentre", () => {
    fc.assert(
      fc.property(latLng, tourPoint, latLng, latLng, (c, p, a, b) => {
        expect(worldErrorM(c, p, a, b)).toBeLessThan(1e-3);
      }),
      { numRuns: 200 },
    );
  });

  // The sweep: the largest error of a fixed sample against each tolerance;
  // the report names the error, so a reader sees how far each one is.
  it("holds every tolerance of the sweep, down to 1e-6 m, in doubles", () => {
    const sample = fc.sample(fc.tuple(latLng, tourPoint, latLng, latLng), {
      numRuns: 300,
      seed: 7,
    });
    const worst = Math.max(
      ...sample.map(([c, p, a, b]) => worldErrorM(c, p, a, b)),
    );
    for (const tolerance of TOLERANCES_M) {
      expect(worst, `worst ${worst} m against ${tolerance} m`).toBeLessThan(
        tolerance,
      );
    }
  });

  // Why: the value that would fail. The same path through a float32 copy
  // of the tour frame's matrix misses even the loosest tolerance.
  it("fails every tolerance of the sweep through a float32 matrix", () => {
    const worst = Math.max(
      ...[
        { lat: 48.1374, lng: 11.5755 },
        { lat: -33.86, lng: 151.21 },
        { lat: 64.15, lng: -21.94 },
      ].map((c) => worldErrorM(c, [12, 560, -40], c, c, true)),
    );
    expect(worst).toBeGreaterThan(Math.max(...TOLERANCES_M));
  });
});
