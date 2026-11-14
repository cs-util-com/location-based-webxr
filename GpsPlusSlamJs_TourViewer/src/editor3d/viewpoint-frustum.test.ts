/**
 * Why these tests matter: the field-of-view lines show the creator what
 * the picture's camera saw, so their far frame must be exactly where and
 * as large as the picture hangs in the viewpoint views (the depth ahead
 * along the viewpoint's facing, its lens's width, the image's aspect);
 * and a broken viewpoint from a file must give no lines rather than NaN
 * geometry.
 */
import type { TourPictureViewpoint } from "gps-plus-slam-app-framework/ar/tour-kinds";
import fc from "fast-check";
import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { viewpointForward } from "../kinds/picture/viewpoint-fade.js";
import { FRUSTUM_POINTS, viewpointFrustum } from "./viewpoint-frustum.js";

const VP: TourPictureViewpoint = {
  position: [2, 1.6, -1],
  rotation: [0, 0, 0, 1],
  hfovDeg: 90,
  distanceM: 4,
};

describe("viewpointFrustum", () => {
  // Why: unturned, the viewpoint looks along -Z; a 90 degree lens at 4 m
  // gives a frame 8 m wide and, at 3:4, 6 m high, centred ahead of the eye.
  it("draws the eye's rays to the frame at the picture's depth", () => {
    const points = viewpointFrustum(VP, 0.75)!;
    expect(points).toHaveLength(FRUSTUM_POINTS);
    const eye = new THREE.Vector3(...VP.position);
    for (let i = 0; i < 8; i += 2) expect(points[i]!.distanceTo(eye)).toBe(0);
    const corners = [1, 3, 5, 7].map((i) => points[i]!);
    const expected = [
      [-4, -3],
      [4, -3],
      [4, 3],
      [-4, 3],
    ].map(([x, y]) => new THREE.Vector3(2 + x!, 1.6 + y!, -5));
    corners.forEach((c, i) => {
      expect(c.distanceTo(expected[i]!)).toBeCloseTo(0, 9);
    });
    // The frame's edges join the corners in order around it.
    for (let i = 0; i < 4; i++) {
      expect(points[8 + 2 * i]!.equals(corners[i]!)).toBe(true);
      expect(points[9 + 2 * i]!.equals(corners[(i + 1) % 4]!)).toBe(true);
    }
  });

  // Why: the frame's centre is where "Look from the viewpoint" aims (the
  // depth ahead along the facing) for any turn, and its width is the
  // lens's at that depth.
  it("centres the frame on the viewpoint's facing for any turn (property)", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -Math.PI, max: Math.PI, noNaN: true }),
        fc.double({ min: -1.2, max: 1.2, noNaN: true }),
        fc.double({ min: 5, max: 150, noNaN: true }),
        fc.double({ min: 0.5, max: 60, noNaN: true }),
        fc.double({ min: 0.3, max: 3, noNaN: true }),
        (yaw, pitch, hfovDeg, distanceM, aspect) => {
          const q = new THREE.Quaternion().setFromEuler(
            new THREE.Euler(pitch, yaw, 0, "YXZ"),
          );
          const vp: TourPictureViewpoint = {
            position: [1, 2, 3],
            rotation: [q.x, q.y, q.z, q.w],
            hfovDeg,
            distanceM,
          };
          const points = viewpointFrustum(vp, aspect)!;
          const corners = [1, 3, 5, 7].map((i) => points[i]!);
          const centre = corners
            .reduce((sum, c) => sum.add(c), new THREE.Vector3())
            .multiplyScalar(0.25);
          const ahead = viewpointForward(vp)
            .multiplyScalar(distanceM)
            .add(new THREE.Vector3(...vp.position));
          expect(centre.distanceTo(ahead)).toBeLessThan(1e-6 * (1 + distanceM));
          const width = corners[0]!.distanceTo(corners[1]!);
          const height = corners[1]!.distanceTo(corners[2]!);
          const lensWidth = 2 * distanceM * Math.tan((hfovDeg * Math.PI) / 360);
          expect(width).toBeCloseTo(lensWidth, 6);
          expect(height / width).toBeCloseTo(aspect, 6);
        },
      ),
    );
  });

  // Why: a viewpoint is file data; a broken one draws nothing.
  it("gives no lines for a viewpoint or aspect it cannot use", () => {
    const broken: [Partial<TourPictureViewpoint>, number][] = [
      [{ hfovDeg: 0 }, 0.75],
      [{ hfovDeg: 180 }, 0.75],
      [{ hfovDeg: Number.NaN }, 0.75],
      [{ distanceM: 0 }, 0.75],
      [{ distanceM: -2 }, 0.75],
      [{ position: [Number.NaN, 0, 0] }, 0.75],
      [{ rotation: [0, 0, 0, 0] }, 0.75],
      [{ rotation: [0, Infinity, 0, 1] }, 0.75],
      [{}, 0],
      [{}, Number.NaN],
    ];
    for (const [change, aspect] of broken) {
      expect(
        viewpointFrustum({ ...VP, ...change }, aspect),
        JSON.stringify(change),
      ).toBeNull();
    }
  });
});
