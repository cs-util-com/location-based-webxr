/**
 * Property-based tests for `createGpsAnchor` — the alignment-frame contract.
 *
 * Why these tests matter: the defining invariant of a `GpsAnchor` is that an
 * anchored object's **world** position equals its GPS-world target and is
 * **independent of the alignment matrix**. The earlier example-based tests
 * all used an identity alignment, which makes a whole family of *wrong*
 * implementations (identity, double-application, inverse, transpose) look
 * correct — that degeneracy hid the alignment-frame bug
 * (gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-31-gps-anchor-alignment-frame-bug.md).
 *
 * A single property — "world pose is invariant under the alignment matrix" —
 * is the cleanest executable spec of what `GpsAnchor` *is*, and it would have
 * caught the bug directly. We pair it with the `inverse(M) ∘ M ≈ I`
 * round-trip that underpins the fix.
 */
// Activates the core library's licence before any module under test loads.
import '../test-setup';
import { afterEach, describe, expect, it } from 'vitest';
import * as fc from 'fast-check';
import * as THREE from 'three';
import { createGpsAnchor } from './gps-anchor.js';
import { clearFrameUpdates } from '../ar/frame-loop.js';
import { calcRelativeCoordsInMeters } from '../core/index.js';

afterEach(() => {
  clearFrameUpdates();
});

// ---------------------------------------------------------------------------
// Arbitraries — random RIGID alignment matrices (rotation + translation, unit
// scale), mirroring the real alignment matrix whose scale ≈ 1. Unit
// scale keeps the transform exactly invertible and distance-preserving.
// ---------------------------------------------------------------------------

const arbUnit = fc.double({ min: -1, max: 1, noNaN: true });
const arbAngle = fc.double({ min: -Math.PI, max: Math.PI, noNaN: true });
const arbTranslationComponent = fc.double({ min: -50, max: 50, noNaN: true });

/** A random rigid 4×4 alignment matrix as a column-major 16-array. */
const arbRigidAlignment = fc
  .record({
    ax: arbUnit,
    ay: arbUnit,
    az: arbUnit,
    angle: arbAngle,
    tx: arbTranslationComponent,
    ty: arbTranslationComponent,
    tz: arbTranslationComponent,
  })
  .map(({ ax, ay, az, angle, tx, ty, tz }) => {
    const axis = new THREE.Vector3(ax, ay, az);
    // Guard a degenerate (near-zero) axis so the quaternion is well defined.
    if (axis.lengthSq() < 1e-6) axis.set(1, 2, 3);
    axis.normalize();
    const quat = new THREE.Quaternion().setFromAxisAngle(axis, angle);
    const matrix = new THREE.Matrix4().compose(
      new THREE.Vector3(tx, ty, tz),
      quat,
      new THREE.Vector3(1, 1, 1)
    );
    return matrix.toArray();
  });

/** GPS target offsets (degrees) ≈ ±110 m around a fixed origin near Munich. */
const arbLatOffset = fc.double({ min: -0.001, max: 0.001, noNaN: true });
const arbLonOffset = fc.double({ min: -0.001, max: 0.001, noNaN: true });

function applyAlignmentToGroup(
  group: THREE.Object3D,
  matrix16: readonly number[]
): void {
  group.matrix.fromArray(matrix16);
  group.matrixAutoUpdate = false;
  group.updateMatrixWorld(true);
}

describe('createGpsAnchor — alignment-frame properties', () => {
  it('the anchored object WORLD position is invariant under the alignment matrix', () => {
    const zero = { lat: 48.0, lon: 11.0 };
    fc.assert(
      fc.property(
        arbRigidAlignment,
        arbLatOffset,
        arbLonOffset,
        (alignment, dLat, dLon) => {
          const arWorldGroup = new THREE.Group();
          const object3D = new THREE.Object3D();
          arWorldGroup.add(object3D);
          applyAlignmentToGroup(arWorldGroup, alignment);
          const camera = new THREE.PerspectiveCamera();
          const target = { lat: zero.lat + dLat, lon: zero.lon + dLon };
          const anchor = createGpsAnchor({
            arWorldGroup,
            object3D,
            camera,
            gpsPoint: target,
            skipBootstrap: true,
            mode: 'snap-every-tick',
            // Force a commit every tick so this property isolates *where* the
            // commit lands (the frame contract) from the distance-scaled
            // threshold gate, which legitimately skips small moves and would
            // otherwise leave the object at its initial local (0,0,0) for the
            // (common) random draws whose AR-local displacement is below the
            // gate — that is correct anchor behaviour, just not what this
            // property is about.
            distanceThreshold: 0,
            getAlignmentMatrix: () => alignment,
            getGpsZeroRef: () => zero,
            getCurrentGpsPoint: () => null,
          });
          anchor.__tickForTests(1, 1);
          const nue = calcRelativeCoordsInMeters(zero, target);
          const world = object3D.getWorldPosition(new THREE.Vector3());
          anchor.dispose();
          clearFrameUpdates();
          // World position equals the GPS-world target regardless of the
          // (arbitrary, non-trivial) alignment matrix. 1 mm tolerance; the
          // double-applied bug would land the object tens of metres away.
          expect(world.x).toBeCloseTo(nue[0], 3);
          expect(world.y).toBeCloseTo(nue[1], 3);
          expect(world.z).toBeCloseTo(nue[2], 3);
        }
      )
    );
  });

  it('inverse(M) ∘ M ≈ identity for any rigid alignment matrix', () => {
    fc.assert(
      fc.property(arbRigidAlignment, (alignment) => {
        const m = new THREE.Matrix4().fromArray(alignment);
        const composed = new THREE.Matrix4().copy(m).invert().multiply(m);
        const identity = new THREE.Matrix4(); // identity by default
        const a = composed.elements;
        const b = identity.elements;
        for (let i = 0; i < 16; i++) {
          expect(a[i]).toBeCloseTo(b[i]!, 5);
        }
      })
    );
  });
});
