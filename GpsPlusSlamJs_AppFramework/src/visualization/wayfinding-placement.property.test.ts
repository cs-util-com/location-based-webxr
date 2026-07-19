/**
 * Property-based tests for the wayfinding placement seam.
 *
 * Why these tests matter: the example-based parity tests pin single points of
 * the ported Prototype-2 behavior; these properties pin the CONTRACTS the HUD
 * presenter relies on every frame, per the graduation plan
 * (GpsPlusSlamJs_Docs/docs/2026-07-17-0756-wayfinding-hud-framework-graduation-plan.md):
 *
 * 1. Hysteresis: the distanceMin/distanceMax deadband never flickers — a
 *    hidden target activates only at ≥ distanceMax (monotone activation), a
 *    visible one hides only below distanceMin, for ANY frame sequence.
 * 2. Edge margin: an arrow placement always lies inside (and on the boundary
 *    of) the edge-margin rectangle of the HUD plane.
 * 3. Behind-camera flip symmetry: a target and its point reflection through
 *    the camera produce arrows pointing in exactly opposite directions.
 */
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import * as THREE from 'three';

import {
  computeTargetPlacement,
  getHudFrustumExtents,
  type TargetPlacementState,
} from './wayfinding-placement.js';

function makeCamera(): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(60, 2, 0.1, 100);
  camera.position.set(0, 0, 0);
  camera.lookAt(0, 0, -1);
  camera.updateMatrixWorld(true);
  return camera;
}

describe('computeTargetPlacement — hysteresis properties', () => {
  // The on-screen state machine, specified independently of the
  // implementation: from 'hidden', activation requires distance ≥ max;
  // from any visible state, deactivation requires distance < min.
  it('deadband never flickers and activation is monotone for any frame sequence', () => {
    const camera = makeCamera();
    fc.assert(
      fc.property(
        fc.double({ min: 0.5, max: 3, noNaN: true }), // distanceMin
        fc.double({ min: 0.1, max: 4, noNaN: true }), // deadband width
        fc.array(fc.double({ min: 0.05, max: 10, noNaN: true }), {
          minLength: 1,
          maxLength: 50,
        }),
        (distanceMin, deadband, distances) => {
          const distanceMax = distanceMin + deadband;
          let previousState: TargetPlacementState = 'hidden';

          for (const d of distances) {
            const placement = computeTargetPlacement({
              targetWorldPos: new THREE.Vector3(0, 0, -d), // always on-screen
              camera,
              hudDistance: 2.5,
              distanceMin,
              distanceMax,
              previousState,
            });

            // Monotone activation: only distanceMax wakes a hidden target.
            // No flicker: a visible target survives the whole deadband.
            const threshold =
              previousState === 'hidden' ? distanceMax : distanceMin;
            expect(placement.state).toBe(d >= threshold ? 'circle' : 'hidden');
            previousState = placement.state;
          }
        }
      )
    );
  });
});

describe('computeTargetPlacement — arrow edge-margin properties', () => {
  it('arrow placements always lie on the edge-margin rectangle of the HUD plane', () => {
    const camera = makeCamera();
    const hudDistance = 2.5;
    const { width, height } = getHudFrustumExtents(camera, hudDistance, false);

    fc.assert(
      fc.property(
        fc.double({ min: -50, max: 50, noNaN: true }),
        fc.double({ min: -50, max: 50, noNaN: true }),
        fc.double({ min: -50, max: 50, noNaN: true }),
        fc.double({ min: 0.1, max: 0.95, noNaN: true }), // edgeMargin
        (x, y, z, edgeMargin) => {
          const placement = computeTargetPlacement({
            targetWorldPos: new THREE.Vector3(x, y, z),
            camera,
            hudDistance,
            distanceMin: 1.5,
            distanceMax: 3.0,
            edgeMargin,
          });
          fc.pre(placement.state === 'arrow');
          if (placement.state !== 'arrow') return;

          const maxAbsX = (width / 2) * edgeMargin;
          const maxAbsY = (height / 2) * edgeMargin;
          const { arrowPosition } = placement;

          // Inside the margin rectangle (with float headroom)…
          expect(Math.abs(arrowPosition.x)).toBeLessThanOrEqual(
            maxAbsX * (1 + 1e-9)
          );
          expect(Math.abs(arrowPosition.y)).toBeLessThanOrEqual(
            maxAbsY * (1 + 1e-9)
          );
          // …and pinned to its boundary: one axis reaches its margin.
          const boundaryRatio = Math.max(
            Math.abs(arrowPosition.x) / maxAbsX,
            Math.abs(arrowPosition.y) / maxAbsY
          );
          expect(boundaryRatio).toBeGreaterThan(1 - 1e-6);
          // Always on the HUD plane.
          expect(arrowPosition.z).toBe(-hudDistance);
        }
      )
    );
  });
});

describe('computeTargetPlacement — behind-camera flip symmetry', () => {
  // A point and its reflection through the camera origin project to the SAME
  // ndc.x/ndc.y (clip and w both negate); the isBehind flip must therefore
  // produce an arrow pointing in exactly the OPPOSITE direction of the
  // front-side arrow — that is what "the arrow points where you must turn"
  // means geometrically.
  it('point reflection through the camera yields opposite arrow directions', () => {
    const camera = makeCamera();
    fc.assert(
      fc.property(
        fc.double({ min: -40, max: 40, noNaN: true }),
        fc.double({ min: -40, max: 40, noNaN: true }),
        fc.double({ min: 1, max: 40, noNaN: true }), // in FRONT (z < 0)
        (x, y, depth) => {
          const front = new THREE.Vector3(x, y, -depth);
          const behind = front.clone().multiplyScalar(-1);

          const base = {
            camera,
            hudDistance: 2.5,
            distanceMin: 1.5,
            distanceMax: 3.0,
          };
          const frontPlacement = computeTargetPlacement({
            ...base,
            targetWorldPos: front,
          });
          // Only compare arrow-vs-arrow: require the front target to be
          // clearly off-screen (the behind one is an arrow by definition).
          fc.pre(frontPlacement.state === 'arrow');
          if (frontPlacement.state !== 'arrow') return;

          const behindPlacement = computeTargetPlacement({
            ...base,
            targetWorldPos: behind,
          });
          expect(behindPlacement.isBehind).toBe(true);
          expect(behindPlacement.state).toBe('arrow');
          if (behindPlacement.state !== 'arrow') return;

          // Opposite direction: positions are point-symmetric on the HUD
          // plane and rotations differ by π (compare via sin/cos to avoid
          // angle-wrapping issues).
          expect(behindPlacement.arrowPosition.x).toBeCloseTo(
            -frontPlacement.arrowPosition.x,
            6
          );
          expect(behindPlacement.arrowPosition.y).toBeCloseTo(
            -frontPlacement.arrowPosition.y,
            6
          );
          const delta =
            behindPlacement.arrowRotationZ - frontPlacement.arrowRotationZ;
          expect(Math.cos(delta)).toBeCloseTo(-1, 6);
        }
      )
    );
  });
});
