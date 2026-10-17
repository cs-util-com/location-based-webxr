/**
 * The globe's world frame (F2 plan 2026-10-03-1922 F2a, M3).
 *
 * Why this test matters: the framework's sky, haze and cloud slab read the
 * zenith from world y and the altitude from the camera's world y, so the
 * globe must be drawn in a local frame at the target (x east, y up, the
 * origin on the ground there) for them to work below the band. Every
 * camera writer and reader then goes through ONE conversion between ECEF
 * and that world; a single writer that skipped it would put the camera on
 * the wrong side of the Earth. These tests pin the frame's axes at the
 * target and the conversion's round trip, including at the poles and the
 * antimeridian.
 */
import * as THREE from "three";
import fc from "fast-check";
import { WGS84_ELLIPSOID } from "3d-tiles-renderer";
import { describe, expect, it } from "vitest";

import {
  GLOBE_FRAME,
  applyEcefPose,
  ecefFromCityAt,
  ecefPoseOf,
  frameRecentreTarget,
  worldFromEcefAt,
} from "./globe-frame.js";
import { GLOBE_DETAIL } from "./globe-detail.js";

const DEG = Math.PI / 180;

describe("worldFromEcefAt", () => {
  it("puts the target's ground point at the origin, east on x, up on y and north on -z", () => {
    const e = WGS84_ELLIPSOID;
    const target = { lat: 46.5, lng: 9 };
    const m = worldFromEcefAt(e, target, new THREE.Matrix4());
    const ground = e.getCartographicToPosition(
      target.lat * DEG,
      target.lng * DEG,
      0,
      new THREE.Vector3(),
    );
    expect(ground.clone().applyMatrix4(m).length()).toBeLessThan(1e-6);
    const east = new THREE.Vector3();
    const north = new THREE.Vector3();
    const up = new THREE.Vector3();
    e.getEastNorthUpAxes(target.lat * DEG, target.lng * DEG, east, north, up);
    const dir = (v: THREE.Vector3) => v.clone().transformDirection(m);
    expect(dir(east).distanceTo(new THREE.Vector3(1, 0, 0))).toBeLessThan(
      1e-12,
    );
    expect(dir(up).distanceTo(new THREE.Vector3(0, 1, 0))).toBeLessThan(1e-12);
    expect(dir(north).distanceTo(new THREE.Vector3(0, 0, -1))).toBeLessThan(
      1e-12,
    );
    // A point 1 km up lands at y = 1,000.
    const above = e
      .getCartographicToPosition(
        target.lat * DEG,
        target.lng * DEG,
        1000,
        new THREE.Vector3(),
      )
      .applyMatrix4(m);
    expect(above.y).toBeCloseTo(1000, 6);
  });

  it("refuses a target that is not a finite latitude and longitude", () => {
    for (const t of [
      { lat: Number.NaN, lng: 0 },
      { lat: 0, lng: Infinity },
      { lat: 91, lng: 0 },
    ]) {
      expect(() =>
        worldFromEcefAt(WGS84_ELLIPSOID, t, new THREE.Matrix4()),
      ).toThrow(RangeError);
    }
  });
});

describe("applyEcefPose and ecefPoseOf", () => {
  it("round-trip a pose through any frame, at the poles and the antimeridian too", () => {
    const lat = fc.double({ min: -90, max: 90, noNaN: true });
    const lng = fc.double({ min: -180, max: 180, noNaN: true });
    fc.assert(
      fc.property(lat, lng, lat, lng, (tLat, tLng, cLat, cLng) => {
        const m = worldFromEcefAt(
          WGS84_ELLIPSOID,
          { lat: tLat, lng: tLng },
          new THREE.Matrix4(),
        );
        const position = WGS84_ELLIPSOID.getCartographicToPosition(
          cLat * DEG,
          cLng * DEG,
          150_000,
          new THREE.Vector3(),
        );
        const quaternion = new THREE.Quaternion()
          .setFromEuler(new THREE.Euler(cLat * DEG, cLng * DEG, 0.3))
          .normalize();
        const camera = new THREE.PerspectiveCamera();
        applyEcefPose(camera, { position, quaternion }, m);
        const back = ecefPoseOf(camera, m);
        expect(back.position.distanceTo(position)).toBeLessThan(1e-3);
        expect(Math.abs(back.quaternion.dot(quaternion))).toBeGreaterThan(
          1 - 1e-12,
        );
      }),
    );
  });

  it("is the identity with the identity frame (ECEF before any target)", () => {
    const camera = new THREE.PerspectiveCamera();
    const position = new THREE.Vector3(1, 2, 3);
    const quaternion = new THREE.Quaternion(0.1, 0.2, 0.3, 0.9).normalize();
    applyEcefPose(camera, { position, quaternion }, new THREE.Matrix4());
    expect(camera.position.toArray()).toEqual([1, 2, 3]);
    expect(1 - Math.abs(camera.quaternion.dot(quaternion))).toBeLessThan(1e-12);
  });
});

// Why (owner's phone, 2026-10-06): the frame stayed on the link's target
// while the owner flew 244 km by hand; there the flat frame stood 4.7 km
// off the curved ground and 2.2 degrees off its vertical, so the cloud
// deck, flat in the frame, floated above an 11 km camera as clouds in the
// sky. The frame follows the camera once it drifts too far from it.
describe("frameRecentreTarget", () => {
  const e = WGS84_ELLIPSOID;
  const bern = { lat: 46.948, lng: 7.4474 };

  it("moves the frame under the camera once it is further than the drift allows", () => {
    const far = { lat: 46.0157, lng: 10.3156 };
    expect(frameRecentreTarget(e, bern, far, 11_200)).toEqual(far);
  });

  it("keeps the frame within the drift, high above the ground, and without a frame", () => {
    const near = { lat: 46.948, lng: 7.6 }; // about 11.6 km east
    expect(frameRecentreTarget(e, bern, near, 11_200)).toBeNull();
    const far = { lat: 46.0157, lng: 10.3156 };
    expect(
      frameRecentreTarget(e, bern, far, GLOBE_FRAME.recentreBelowM + 1),
    ).toBeNull();
    expect(frameRecentreTarget(e, null, far, 11_200)).toBeNull();
  });

  it("refuses a non-finite position or altitude", () => {
    expect(() =>
      frameRecentreTarget(e, bern, { lat: Number.NaN, lng: 0 }, 1_000),
    ).toThrow(RangeError);
    expect(() =>
      frameRecentreTarget(e, bern, bern, Number.POSITIVE_INFINITY),
    ).toThrow(RangeError);
  });

  // A property: the result is null or exactly the camera's ground point,
  // and it is the ground point exactly when the drift is beyond the bound
  // (the bound swept against the ellipsoid's own distance).
  it("recentres exactly when the ground distance exceeds the drift", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -60, max: 60, noNaN: true }),
        fc.double({ min: -179, max: 179, noNaN: true }),
        fc.double({ min: -0.6, max: 0.6, noNaN: true }),
        fc.double({ min: -0.6, max: 0.6, noNaN: true }),
        (lat, lng, dLat, dLng) => {
          const frame = { lat, lng };
          const camera = { lat: lat + dLat, lng: lng + dLng };
          const a = e.getCartographicToPosition(
            (lat * Math.PI) / 180,
            (lng * Math.PI) / 180,
            0,
            new THREE.Vector3(),
          );
          const b = e.getCartographicToPosition(
            (camera.lat * Math.PI) / 180,
            (camera.lng * Math.PI) / 180,
            0,
            new THREE.Vector3(),
          );
          const result = frameRecentreTarget(e, frame, camera, 5_000);
          const beyond = a.distanceTo(b) > GLOBE_FRAME.recentreDriftM;
          expect(result).toEqual(beyond ? camera : null);
        },
      ),
    );
  });
});

// WHY (globe city plan 2026-10-05-0040 §12.4 R2, §14 D-K7): the city is
// built in the Osm library's local frame, whose metres a degree are the AR
// core's ruler (0.1-0.2 % off the true ellipsoid, kept so the city agrees
// with the phone in AR), while the globe draws the true ellipsoid. Placed
// rigidly, a building 2.4 km out stood 3-4 m from where the relief has its
// latitude and longitude. `ecefFromCityAt` scales the city per axis back to
// the true ellipsoid's metres at the target and places it there.
//
// THE BOUND IS THE FLAT FRAME'S OWN ERROR, never zero: 1.2 m of curvature
// over the window's 3.4 km diagonal, plus the frame's vertical: it is the
// target's, so a point h metres up and d metres out leans by about
// h d / R (heights to 4.8 km, the Alps' peaks: the r790 milestone review
// F3 found the bound failing from 2 km up while the test stopped at 1 km),
// plus two terms that grow with the latitude, because the frame's
// east scale is fixed at the origin's latitude: a parallel curves on the
// tangent plane by about e^2 tan(|lat|) / 2R, and a point n metres north is
// sheared east by about |e| |n| tan(|lat|) / R. Neither is removable by a
// per-axis scale, and AR's frame has both, so they are inherent. Computed
// over a dense grid: the worst corner is 1.05 m at the equator, 1.57 m at
// 45, 3.13 m at 70; with the three terms taken away at most 0.90 m remains
// anywhere, to 4.8 km up. Earlier fixed bounds (1 m, then 1.5 m) passed only because the
// random samples rarely reached a corner, so the corners are always
// included below. Uncorrected, the error is 3-4 m along the axes at 47 N,
// where both terms are near 0, so a missing scale still fails.
describe("ecefFromCityAt", () => {
  const ruler = {
    north: GLOBE_DETAIL.metresPerDegLat,
    east: GLOBE_DETAIL.metresPerDegLngEquator,
  };
  const R = 6_371_000;
  const boundM = (lat: number, eastM: number, northM: number, h: number) =>
    1.2 +
    (h * Math.hypot(eastM, northM)) / R +
    ((eastM * eastM) / 2 + Math.abs(eastM) * Math.abs(northM)) *
      (Math.tan(Math.abs(lat) * DEG) / R);
  it("puts a city point within the flat frame's own error of its latitude, longitude and height", () => {
    const e = WGS84_ELLIPSOID;
    let worstShare = 0;
    const corners: [number, number, number, number, number][] = [];
    for (const lat of [0, 47, -47, 70, -70]) {
      for (const [eastM, northM] of [
        [2400, 2400],
        [-2400, 2400],
        [2400, -2400],
        [-2400, -2400],
        [2400, 0],
        [0, 2400],
      ] as const) {
        corners.push([lat, 7.4, eastM, northM, 4800]);
        corners.push([lat, 7.4, eastM, northM, 0]);
      }
    }
    fc.assert(
      fc.property(
        fc.double({ min: -70, max: 70, noNaN: true }),
        fc.double({ min: -179, max: 179, noNaN: true }),
        fc.double({ min: -2400, max: 2400, noNaN: true }),
        fc.double({ min: -2400, max: 2400, noNaN: true }),
        fc.double({ min: 0, max: 4800, noNaN: true }),
        (lat, lng, eastM, northM, h) => {
          const m = ecefFromCityAt(e, { lat, lng }, new THREE.Matrix4());
          // The Osm frame: x east, y up, z south, in the ruler's metres.
          const placed = new THREE.Vector3(eastM, h, -northM).applyMatrix4(m);
          const pLat = lat + northM / ruler.north;
          const pLng = lng + eastM / (ruler.east * Math.cos(lat * DEG));
          const truth = e.getCartographicToPosition(
            pLat * DEG,
            pLng * DEG,
            h,
            new THREE.Vector3(),
          );
          const d = placed.distanceTo(truth);
          const bound = boundM(lat, eastM, northM, h);
          worstShare = Math.max(worstShare, d / bound);
          expect(d).toBeLessThan(bound);
        },
      ),
      { numRuns: 400, examples: corners },
    );
    console.log(
      `ecefFromCityAt: worst ${(worstShare * 100).toFixed(0)} % of the bound`,
    );
  });

  it("is the frame's inverse at the target, without the scale", () => {
    const t = { lat: 46.948, lng: 7.4474 };
    const m = ecefFromCityAt(WGS84_ELLIPSOID, t, new THREE.Matrix4());
    const origin = new THREE.Vector3().applyMatrix4(m);
    const ground = WGS84_ELLIPSOID.getCartographicToPosition(
      t.lat * DEG,
      t.lng * DEG,
      0,
      new THREE.Vector3(),
    );
    expect(origin.distanceTo(ground)).toBeLessThan(1e-6);
  });
});
