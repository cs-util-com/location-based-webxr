/**
 * Why these tests matter: every station, item and code in the 3D editor is
 * placed through one matrix per point: the globe's frame, the point's own
 * east-up-south frame on the ellipsoid lowered by the geoid's N (a tour's
 * heights are ellipsoidal; the relief draws orthometric ones), and the
 * tour's north-up-east axes turned into east-up-south. A swapped axis or a
 * sign puts a tour mirrored or tens of metres under the ground, and still
 * draws something plausible. These check the matrix against points
 * computed by hand and against the ellipsoid itself, and the model size
 * rule against boxes of known size.
 */
import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { worldFromEcefAt } from "gps-plus-slam-globe/editor";

import { modelScale, pointRootMatrix } from "./editor3d-tour-root.js";

const FRAME = { lat: 48.137393, lng: 11.575493 };
const DEG = Math.PI / 180;

/** WGS84, written out (a, f): geodetic to ECEF by the textbook formula,
 *  so the matrix is checked against arithmetic, not against the library
 *  it is built on. */
const A = 6_378_137;
const F = 1 / 298.257223563;
const E2 = F * (2 - F);
function ecefOf(latRad: number, lonRad: number, h: number, out: THREE.Vector3) {
  const n = A / Math.sqrt(1 - E2 * Math.sin(latRad) ** 2);
  return out.set(
    (n + h) * Math.cos(latRad) * Math.cos(lonRad),
    (n + h) * Math.cos(latRad) * Math.sin(lonRad),
    (n * (1 - E2) + h) * Math.sin(latRad),
  );
}
type GlobeEllipsoid = Parameters<typeof worldFromEcefAt>[0];
const WGS84_ELLIPSOID = {
  getCartographicToPosition: ecefOf,
} as unknown as GlobeEllipsoid;

function frameMatrix(): THREE.Matrix4 {
  return worldFromEcefAt(WGS84_ELLIPSOID, FRAME, new THREE.Matrix4());
}

describe("pointRootMatrix", () => {
  // Why: at the frame's own centre the matrix is only the axes and the
  // geoid: north-up-east (1, 10, 2) is 2 m east, 10 - N up and 1 m north,
  // which the world (x east, y up, z south) writes as (2, 10 - N, -1).
  it("maps north-up-east to east, up less N, south at the frame's centre", () => {
    const root = pointRootMatrix(
      {
        ellipsoid: WGS84_ELLIPSOID,
        worldFromEcef: frameMatrix(),
        place: { lat: FRAME.lat, lon: FRAME.lng },
        undulationM: 45.68,
      },
      new THREE.Matrix4(),
    );
    const p = new THREE.Vector3(1, 10, 2).applyMatrix4(root);
    expect(p.x).toBeCloseTo(2, 6);
    expect(p.y).toBeCloseTo(10 - 45.68, 6);
    expect(p.z).toBeCloseTo(-1, 6);
    // A rotation, not a mirror: the axes keep their handedness.
    expect(root.determinant()).toBeCloseTo(1, 9);
  });

  // Why: a point's own height (0, alt, 0) must land exactly where the
  // ellipsoid puts its latitude and longitude at the drawn height alt - N,
  // wherever the point is in the frame; checked 100 m east and 300 m
  // north-west of the centre, where the frame's flat world and the curved
  // ground already differ by millimetres to centimetres.
  it("puts a point's height where the ellipsoid puts it, away from the centre", () => {
    const worldFromEcef = frameMatrix();
    const mPerDegLat = 111_200;
    const mPerDegLon = 111_320 * Math.cos(FRAME.lat * DEG);
    for (const [east, north, alt, n] of [
      [100, 0, 561.5, 45.68],
      [-212, 212, 600, 45.7],
    ] as const) {
      const place = {
        lat: FRAME.lat + north / mPerDegLat,
        lon: FRAME.lng + east / mPerDegLon,
      };
      const root = pointRootMatrix(
        { ellipsoid: WGS84_ELLIPSOID, worldFromEcef, place, undulationM: n },
        new THREE.Matrix4(),
      );
      const drawn = new THREE.Vector3(0, alt, 0).applyMatrix4(root);
      const expected = ecefOf(
        place.lat * DEG,
        place.lon * DEG,
        alt - n,
        new THREE.Vector3(),
      ).applyMatrix4(worldFromEcef);
      expect(drawn.distanceTo(expected)).toBeLessThan(1e-6);
      // And roughly where the flat world puts it (the ground curves away
      // by d^2 / 2R: under a centimetre 300 m out).
      expect(drawn.x).toBeCloseTo(east, -1);
      expect(-drawn.z).toBeCloseTo(north, -1);
      expect(drawn.y).toBeCloseTo(alt - n, 1);
    }
  });

  // Why: the world's heights come from the file; a NaN must fail where it
  // is made, not draw a station at the centre of the Earth.
  it("refuses a place or an undulation that is not finite", () => {
    const base = {
      ellipsoid: WGS84_ELLIPSOID,
      worldFromEcef: frameMatrix(),
      place: { lat: FRAME.lat, lon: FRAME.lng },
      undulationM: 45,
    };
    expect(() =>
      pointRootMatrix(
        { ...base, undulationM: Number.NaN },
        new THREE.Matrix4(),
      ),
    ).toThrow(RangeError);
    expect(() =>
      pointRootMatrix(
        { ...base, place: { lat: 91, lon: 0 } },
        new THREE.Matrix4(),
      ),
    ).toThrow(RangeError);
    expect(() =>
      pointRootMatrix(
        { ...base, place: { lat: 0, lon: Number.NaN } },
        new THREE.Matrix4(),
      ),
    ).toThrow(RangeError);
  });
});

describe("modelScale", () => {
  // Why: a placed model's `sizeM` is its LARGEST side after scaling (the
  // format's one rule): a box 2 x 4 x 1 m asked to be 8 m is scaled by 2,
  // whatever its own node transforms are.
  it("scales the largest side of the model's box to the size", () => {
    const model = new THREE.Group();
    const box = new THREE.Mesh(new THREE.BoxGeometry(2, 4, 1));
    model.add(box);
    expect(modelScale(model, 8)).toBeCloseTo(2, 9);
    // A node transform counts: the same box scaled by 3 inside the model.
    box.scale.setScalar(3);
    expect(modelScale(model, 6)).toBeCloseTo(0.5, 9);
  });

  // Why: a model with nothing to measure (an empty scene, a point) must
  // not be blown up to infinity; it is drawn at its own size.
  it("keeps a model with no extent at its own size", () => {
    expect(modelScale(new THREE.Group(), 5)).toBe(1);
    const flat = new THREE.Group();
    flat.add(new THREE.Mesh(new THREE.PlaneGeometry(0, 0)));
    expect(modelScale(flat, 5)).toBe(1);
  });

  it("refuses a size that is not finite and > 0", () => {
    const model = new THREE.Group();
    model.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)));
    expect(() => modelScale(model, 0)).toThrow(RangeError);
    expect(() => modelScale(model, Number.NaN)).toThrow(RangeError);
  });
});
