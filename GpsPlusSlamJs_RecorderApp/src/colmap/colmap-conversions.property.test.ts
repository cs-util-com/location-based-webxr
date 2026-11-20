/**
 * Property tests for COLMAP coordinate conversions.
 *
 * Why this test file matters:
 * The WebXR→COLMAP coordinate conversion is the single highest-risk piece of
 * the COLMAP export (plan §2.3/§6 — a sign error mirrors or flips the whole
 * scene). These properties pin the EXACT convention across the full space of
 * poses, the way identity-only example tests cannot:
 *  - pose: a world point's COLMAP camera coordinates must equal the
 *    basis-changed WebXR view coordinates of the same point, for any pose.
 * (The intrinsics' tests moved with `pinholeFromProjection` to the framework,
 * `utils/pinhole-from-projection.property.test.ts`.)
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import * as THREE from 'three';
import type { Quaternion, Vector3 } from 'gps-plus-slam-app-framework/core';
import {
  webxrToColmapPose,
  webxrToColmapWorldPoint,
} from './colmap-conversions';

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const finite = (min: number, max: number) =>
  fc.double({ min, max, noNaN: true, noDefaultInfinity: true });

/** Arbitrary normalized quaternion [x,y,z,w] (uniform-ish over orientations). */
const arbQuat: fc.Arbitrary<Quaternion> = fc
  .tuple(finite(-1, 1), finite(-1, 1), finite(-1, 1), finite(-1, 1))
  .filter(([x, y, z, w]) => Math.hypot(x, y, z, w) > 1e-3)
  .map(([x, y, z, w]) => {
    const n = Math.hypot(x, y, z, w);
    return [x / n, y / n, z / n, w / n] as Quaternion;
  });

const arbPos: fc.Arbitrary<Vector3> = fc.tuple(
  finite(-50, 50),
  finite(-50, 50),
  finite(-50, 50)
);

// ---------------------------------------------------------------------------
// webxrToColmapPose
// ---------------------------------------------------------------------------

describe('webxrToColmapPose (property)', () => {
  it('keeps cameras and points registered (flipped world point → true camera coords)', () => {
    // The single most important invariant: after the world basis change (Item B,
    // the upside-down fix), the extrinsic applied to the FLIPPED world point must
    // still reproduce the physical point's COLMAP camera coordinates. If it did
    // not, points and cameras would drift apart and the reconstruction would be
    // mis-registered. Expected = WebXR view coords then the camera basis change
    // (negate Y,Z) — unchanged by the world flip; only the world point we feed in
    // is flipped to match the new world frame.
    fc.assert(
      fc.property(arbPos, arbQuat, arbPos, (camPos, camRot, worldPoint) => {
        const camToWorld = new THREE.Matrix4().compose(
          new THREE.Vector3(...camPos),
          new THREE.Quaternion(camRot[0], camRot[1], camRot[2], camRot[3]),
          new THREE.Vector3(1, 1, 1)
        );
        const worldToWebxrView = camToWorld.clone().invert();
        const viewWebxr = new THREE.Vector3(...worldPoint).applyMatrix4(
          worldToWebxrView
        );
        const expected = new THREE.Vector3(
          viewWebxr.x,
          -viewWebxr.y,
          -viewWebxr.z
        );

        // Actual: X_cam = R(qvec)·(G·X_world) + tvec, with G the world flip.
        const { qvec, tvec } = webxrToColmapPose(camPos, camRot);
        const rot = new THREE.Quaternion(qvec[1], qvec[2], qvec[3], qvec[0]);
        const actual = new THREE.Vector3(...webxrToColmapWorldPoint(worldPoint))
          .applyQuaternion(rot)
          .add(new THREE.Vector3(...tvec));

        expect(actual.x).toBeCloseTo(expected.x, 5);
        expect(actual.y).toBeCloseTo(expected.y, 5);
        expect(actual.z).toBeCloseTo(expected.z, 5);
      }),
      { numRuns: 500 }
    );
  });

  it('returns a unit quaternion', () => {
    fc.assert(
      fc.property(arbPos, arbQuat, (camPos, camRot) => {
        const { qvec } = webxrToColmapPose(camPos, camRot);
        expect(Math.hypot(...qvec)).toBeCloseTo(1, 6);
      })
    );
  });
});

// ---------------------------------------------------------------------------
// webxrToColmapWorldPoint (the world basis change G = diag(1, −1, −1))
// ---------------------------------------------------------------------------

describe('webxrToColmapWorldPoint (property)', () => {
  it('negates Y and Z, preserves X (180° about X — upright, not mirrored)', () => {
    // Pins the EXACT basis change. Negating exactly Y and Z (and nothing else)
    // makes the matrix diag(1,−1,−1), whose determinant is +1 → a proper
    // rotation, so the splat loads upright WITHOUT mirroring (the report: "not
    // mirrored"). A handedness flip would have negated one or three components.
    fc.assert(
      fc.property(arbPos, (p) => {
        const [x, y, z] = webxrToColmapWorldPoint(p);
        expect(x).toBe(p[0]);
        expect(y).toBe(-p[1]);
        expect(z).toBe(-p[2]);
      })
    );
  });

  it('preserves pairwise distances (it is a rigid rotation, no scaling/shear)', () => {
    fc.assert(
      fc.property(arbPos, arbPos, (a, b) => {
        const fa = webxrToColmapWorldPoint(a);
        const fb = webxrToColmapWorldPoint(b);
        const before = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
        const after = Math.hypot(fa[0] - fb[0], fa[1] - fb[1], fa[2] - fb[2]);
        expect(after).toBeCloseTo(before, 9);
      })
    );
  });
});
