/**
 * Why these tests matter: the layer's promise is that an object's geo pose
 * survives any recentre of the globe's frame, anywhere on Earth, at any
 * height a tour can have. These check it for random places, heights,
 * undulations and pairs of frames, against a geodetic inverse written out
 * by hand (not the library the layer is built on).
 *
 * Parameter: the round-trip tolerance. Declared 1 mm (the bound GV0 set
 * for rendered error); the test also measures the largest error over a
 * fixed sample and checks it stays below every value of a sweep from 1 mm
 * down to 1e-6 m. In doubles the error is about 1e-9 m, so any tolerance
 * down to about 1e-8 m holds; what fails is a float32 path: casting an
 * object's ECEF matrix to float32 (as a buffer of ECEF positions would
 * keep it) errs by tens of centimetres, which fails
 * every tolerance below about 1 m - checked below, so the reason for the
 * design is executable. (three composes the model-view matrix in doubles
 * and uploads only that camera-relative product, so the layer's ECEF
 * matrices never reach the GPU as float32.)
 */
import fc from "fast-check";
import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { worldFromEcefAt } from "gps-plus-slam-globe/editor";

import { createGlobeLayer } from "./globe-layer.js";
import { WGS84_TEXTBOOK, geodeticOf } from "../test-support/wgs84-textbook.js";

const TOLERANCES_M = [1e-3, 1e-4, 1e-5, 1e-6];
const M_PER_DEG = 111_320;

const place = fc.record({
  lat: fc.double({ min: -80, max: 80, noNaN: true }),
  lon: fc.double({ min: -180, max: 180, noNaN: true }),
});
const target = fc.record({
  lat: fc.double({ min: -80, max: 80, noNaN: true }),
  lng: fc.double({ min: -180, max: 180, noNaN: true }),
});

/** The round trip's error (m): placed at a frame, recentred, read back. */
function roundTripErrorM(
  at: { lat: number; lon: number },
  altM: number,
  undulationM: number,
  first: { lat: number; lng: number },
  second: { lat: number; lng: number },
  float32 = false,
): number {
  const earth = new THREE.Group();
  earth.matrixAutoUpdate = false;
  worldFromEcefAt(WGS84_TEXTBOOK, first, earth.matrix);
  const layer = createGlobeLayer(earth);
  const thing = new THREE.Object3D();
  layer.place(thing, { ellipsoid: WGS84_TEXTBOOK, place: at, undulationM });
  worldFromEcefAt(WGS84_TEXTBOOK, second, earth.matrix);
  earth.updateMatrixWorld(true);
  // The object's own matrix is ECEF (translations of about 6,400 km); a
  // float32 copy of it is what a buffer of ECEF positions would keep.
  const own = new THREE.Matrix4().copy(thing.matrix);
  if (float32) own.fromArray(Float32Array.from(own.elements));
  const world = new THREE.Matrix4().multiplyMatrices(earth.matrix, own);
  const point = new THREE.Vector3(0, altM, 0)
    .applyMatrix4(world)
    .applyMatrix4(earth.matrix.clone().invert());
  const geo = geodeticOf(point);
  const northM = (geo.latDeg - at.lat) * M_PER_DEG;
  const eastM =
    (((geo.lonDeg - at.lon + 540) % 360) - 180) *
    M_PER_DEG *
    Math.cos((at.lat * Math.PI) / 180);
  const upM = geo.heightM - (altM - undulationM);
  return Math.hypot(northM, eastM, upM);
}

describe("the globe layer's round trip, for any place and frames", () => {
  it("keeps an object's geo pose within 1 mm across any recentre", () => {
    fc.assert(
      fc.property(
        place,
        fc.double({ min: -100, max: 9_000, noNaN: true }),
        fc.double({ min: -110, max: 90, noNaN: true }),
        target,
        target,
        (at, altM, n, first, second) => {
          expect(roundTripErrorM(at, altM, n, first, second)).toBeLessThan(
            1e-3,
          );
        },
      ),
      { numRuns: 200 },
    );
  });

  // The sweep: the largest error of a fixed sample against each tolerance;
  // the report names the error, so a reader sees how far each one is.
  it("holds every tolerance of the sweep, down to 1e-6 m, in doubles", () => {
    const sample = fc.sample(
      fc.tuple(
        place,
        fc.double({ min: -100, max: 9_000, noNaN: true }),
        fc.double({ min: -110, max: 90, noNaN: true }),
        target,
        target,
      ),
      { numRuns: 300, seed: 7 },
    );
    const worst = Math.max(
      ...sample.map(([at, altM, n, a, b]) =>
        roundTripErrorM(at, altM, n, a, b),
      ),
    );
    for (const tolerance of TOLERANCES_M) {
      expect(worst, `worst ${worst} m against ${tolerance} m`).toBeLessThan(
        tolerance,
      );
    }
  });

  // Why: the value that would fail. The same round trip through float32
  // matrices (ECEF translations of about 6,400 km keep only about half a
  // metre) misses even the loosest tolerance of the sweep.
  it("fails every tolerance of the sweep through float32 matrices", () => {
    const worst = Math.max(
      ...[
        [
          { lat: 46.95, lon: 7.45 },
          { lat: 46.948, lng: 7.4474 },
        ],
        [
          { lat: -33.9, lon: 151.2 },
          { lat: -33.86, lng: 151.21 },
        ],
        [
          { lat: 64.1, lon: -21.9 },
          { lat: 64.15, lng: -21.94 },
        ],
      ].map(([at, frame]) =>
        roundTripErrorM(
          at as { lat: number; lon: number },
          560,
          48,
          frame as { lat: number; lng: number },
          frame as { lat: number; lng: number },
          true,
        ),
      ),
    );
    expect(worst).toBeGreaterThan(Math.max(...TOLERANCES_M));
  });
});
