/**
 * Why this test matters: while the intro drives the camera (the spin, the
 * turn, the pin's dive), the near and far planes follow the altitude
 * (round-2 plan 2026-09-26-2055 M3b). A near plane that is too far clips
 * the ground the camera dives towards; a far plane that is too near clips
 * the visible Earth at its limb. Both are silent: the picture just has a
 * hole. So the planes are checked against the geometry itself, at random
 * camera positions from 1 km to ten Earth radii and random surface points:
 * - every surface point lies at least `near / nearFraction` away, so a view
 *   whose half-diagonal field is within acos(nearFraction) never clips it;
 * - every VISIBLE surface point (on the camera's side of its own tangent
 *   plane) lies within `far`.
 */

import fc from "fast-check";
import * as THREE from "three";
import { WGS84_ELLIPSOID } from "3d-tiles-renderer";
import { describe, expect, it } from "vitest";

import { GLOBE_CLIP, clipPlanes } from "./globe-camera.js";

const DEG = Math.PI / 180;
const R = WGS84_ELLIPSOID.radius.x;

const lat = fc.double({ min: -90, max: 90, noNaN: true });
const lng = fc.double({ min: -180, max: 180, noNaN: true });
/** 1 km to ten Earth radii, spread evenly in log space. */
const altitude = fc
  .double({ min: Math.log(1_000), max: Math.log(10 * R), noNaN: true })
  .map(Math.exp);

const at = (latDeg: number, lngDeg: number, height: number): THREE.Vector3 =>
  WGS84_ELLIPSOID.getCartographicToPosition(
    latDeg * DEG,
    lngDeg * DEG,
    height,
    new THREE.Vector3(),
  );

describe("clipPlanes, against the ellipsoid's geometry", () => {
  it("keeps every surface point beyond the near plane's reach", () => {
    fc.assert(
      fc.property(lat, lng, altitude, lat, lng, (cl, cg, h, sl, sg) => {
        const camera = at(cl, cg, h);
        const { near } = clipPlanes(WGS84_ELLIPSOID, camera);
        const distance = camera.distanceTo(at(sl, sg, 0));
        // The depth of a point seen at angle θ off the view axis is its
        // distance times cos θ, so this is what a wide view needs.
        expect(distance * GLOBE_CLIP.nearFraction).toBeGreaterThanOrEqual(
          near * (1 - 1e-9),
        );
      }),
      { numRuns: 2000 },
    );
  });

  it("keeps every visible surface point within the far plane", () => {
    fc.assert(
      fc.property(lat, lng, altitude, lat, lng, (cl, cg, h, sl, sg) => {
        const camera = at(cl, cg, h);
        const point = at(sl, sg, 0);
        const normal = WGS84_ELLIPSOID.getPositionToNormal(
          point,
          new THREE.Vector3(),
        );
        // A convex surface: a point is visible exactly when the camera is
        // on the outer side of the point's tangent plane.
        fc.pre(normal.dot(camera.clone().sub(point)) > 0);
        const { far } = clipPlanes(WGS84_ELLIPSOID, camera);
        expect(camera.distanceTo(point)).toBeLessThanOrEqual(far);
      }),
      { numRuns: 4000 },
    );
  });

  it("keeps the limb within the far plane: points just on the visible side of it", () => {
    // Random points are rarely near the limb, where the far plane is
    // tightest, so these are placed there: along the camera's horizon
    // circle in every direction, nudged a hair towards the camera.
    fc.assert(
      fc.property(
        lat,
        lng,
        altitude,
        fc.double({ min: 0, max: 2 * Math.PI, noNaN: true }),
        (cl, cg, h, azimuth) => {
          const camera = at(cl, cg, h);
          const { far } = clipPlanes(WGS84_ELLIPSOID, camera);
          const up = camera.clone().normalize();
          const side = new THREE.Vector3(0, 0, 1).cross(up);
          if (side.lengthSq() < 1e-12) side.set(1, 0, 0);
          side.normalize().applyAxisAngle(up, azimuth);
          // Walk from the sub-camera point towards the horizon along this
          // azimuth, keeping the last point still visible.
          let lo = 0;
          let hi = Math.PI / 2;
          // The surface point on the ray from the centre along a direction.
          const { x: a, z: b } = WGS84_ELLIPSOID.radius;
          const surfaceAt = (angle: number) => {
            const dir = up
              .clone()
              .multiplyScalar(Math.cos(angle))
              .addScaledVector(side, Math.sin(angle));
            const k = Math.hypot(dir.x / a, dir.y / a, dir.z / b);
            return dir.divideScalar(k);
          };
          const visible = (p: THREE.Vector3) =>
            WGS84_ELLIPSOID.getPositionToNormal(p, new THREE.Vector3()).dot(
              camera.clone().sub(p),
            ) > 0;
          for (let i = 0; i < 60; i++) {
            const mid = (lo + hi) / 2;
            if (visible(surfaceAt(mid))) lo = mid;
            else hi = mid;
          }
          expect(camera.distanceTo(surfaceAt(lo))).toBeLessThanOrEqual(far);
        },
      ),
      { numRuns: 1000 },
    );
  });
});
