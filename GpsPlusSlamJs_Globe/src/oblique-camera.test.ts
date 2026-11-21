/**
 * Why this test matters: every flight path, the meteor and the lab's test
 * hooks place the camera with this geometry, so a wrong depression or a
 * camera off its altitude moves every view at once. The camera must look
 * at the ground point at the asked depression from the asked altitude, and
 * the surface radius must put the point on the ellipsoid.
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import * as THREE from "three";
import { WGS84_ELLIPSOID } from "3d-tiles-renderer";

import { orbitPose } from "./globe-camera.js";
import { obliqueCamera, surfaceRadiusAlong } from "./oblique-camera.js";

describe("obliqueCamera", () => {
  // Why: the recorder's paths place the camera with the flight's own
  // oblique geometry, so a recorded zoom sees what the flight sees. The
  // camera stands the altitude above the ground under the pose, looks at
  // that ground point and sees it at the asked depression below its local
  // horizontal.
  it("looks at the ground point at the asked depression, from the altitude", () => {
    const ell = WGS84_ELLIPSOID;
    const pose = orbitPose(ell, { lat: 46.5, lng: 9 });
    // Only views that see the ground point: the depression must exceed the
    // horizon's dip (31.6 degrees at 1,000 km; the pitch law keeps 5 more).
    const dipDeg = (alt: number) =>
      (Math.acos(6_371_000 / (6_371_000 + alt)) * 180) / Math.PI;
    for (const pitch of [90, 60, 45, 30]) {
      for (const alt of [5_000, 150_000, 1_000_000]) {
        if (pitch <= dipDeg(alt) + 5) continue;
        const cam = obliqueCamera(ell, pose, alt, pitch);
        const d = pose.direction.clone().normalize();
        const ground = d.clone().multiplyScalar(surfaceRadiusAlong(ell, d));
        const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(
          cam.quaternion,
        );
        const toGround = ground.clone().sub(cam.position).normalize();
        expect(forward.dot(toGround)).toBeGreaterThan(1 - 1e-9);
        const down = cam.position.clone().negate().normalize();
        const depression =
          (Math.asin(Math.min(1, forward.dot(down))) * 180) / Math.PI;
        expect(depression).toBeCloseTo(pitch, pitch === 90 ? 2 : 6);
        const height =
          cam.position.length() - surfaceRadiusAlong(ell, cam.position);
        expect(Math.abs(height - alt) / alt).toBeLessThan(0.01);
      }
    }
  });
});

describe("surfaceRadiusAlong", () => {
  it("meets the ellipsoid: the equatorial radius on the equator, the polar at a pole", () => {
    const { x: a, z: b } = WGS84_ELLIPSOID.radius;
    expect(
      surfaceRadiusAlong(WGS84_ELLIPSOID, new THREE.Vector3(1, 0, 0)),
    ).toBeCloseTo(a, 6);
    expect(
      surfaceRadiusAlong(WGS84_ELLIPSOID, new THREE.Vector3(0, 0, -3)),
    ).toBeCloseTo(b, 6);
    fc.assert(
      fc.property(
        fc.double({ min: -1, max: 1, noNaN: true }),
        fc.double({ min: -1, max: 1, noNaN: true }),
        fc.double({ min: -1, max: 1, noNaN: true }),
        (x, y, z) => {
          const d = new THREE.Vector3(x, y, z);
          fc.pre(d.length() > 1e-3);
          const p = d
            .normalize()
            .multiplyScalar(surfaceRadiusAlong(WGS84_ELLIPSOID, d));
          expect(
            Math.abs(WGS84_ELLIPSOID.getPositionElevation(p)),
          ).toBeLessThan(1e-3);
        },
      ),
    );
  });
});
