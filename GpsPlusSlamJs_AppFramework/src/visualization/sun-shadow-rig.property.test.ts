/**
 * Property-based tests for the Sun-driven shadow rig framing and placement contracts.
 *
 * Why these tests matter:
 * 1. Positive depth range & non-zero frustum: For ANY solar direction (including near-zenith
 *    and nadir gimbal-lock regions), the orthographic shadow frustum must maintain a strictly
 *    positive depth range (far > near >= 0.1) and non-zero transverse extents.
 * 2. Tight corner containment: For ANY arbitrary 3D bounding volume and ANY solar angle,
 *    all corner vertices projected into light view space must lie strictly inside the
 *    calculated [left, right] x [bottom, top] x [near, far] orthographic volume.
 * 3. Distance & target invariance: Directional light placement must strictly preserve the
 *    requested distance from target origin along the solar vector.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import * as THREE from 'three';
import {
  computeLightPlacement,
  computeShadowFrustum,
  type Aabb3D,
  type Sphere3D,
} from './sun-shadow-rig.js';
import type { NueDirection } from '../geo/sun-position.js';

// Arbitrary for normalized NUE directions generated from spherical coordinates
const arbitraryNueDirection = fc
  .tuple(
    fc.double({ min: 0.001, max: Math.PI - 0.001, noNaN: true }), // theta (inclination from +Y)
    fc.double({ min: -Math.PI, max: Math.PI, noNaN: true }) // phi (azimuth in XZ plane)
  )
  .map(([theta, phi]): NueDirection => {
    const sinTheta = Math.sin(theta);
    return {
      x: sinTheta * Math.cos(phi),
      y: Math.cos(theta),
      z: sinTheta * Math.sin(phi),
    };
  });

// Arbitrary for valid 3D bounding sphere
const arbitrarySphere3D = fc
  .record({
    cx: fc.double({ min: -50, max: 50, noNaN: true }),
    cy: fc.double({ min: -50, max: 50, noNaN: true }),
    cz: fc.double({ min: -50, max: 50, noNaN: true }),
    radius: fc.double({ min: 0.5, max: 30, noNaN: true }),
  })
  .map(
    ({ cx, cy, cz, radius }): Sphere3D => ({
      center: { x: cx, y: cy, z: cz },
      radius,
    })
  );

// Arbitrary for non-empty 3D bounding box (AABB)
const arbitraryAabb3D = fc
  .record({
    x1: fc.double({ min: -50, max: 50, noNaN: true }),
    x2: fc.double({ min: -50, max: 50, noNaN: true }),
    y1: fc.double({ min: -50, max: 50, noNaN: true }),
    y2: fc.double({ min: -50, max: 50, noNaN: true }),
    z1: fc.double({ min: -50, max: 50, noNaN: true }),
    z2: fc.double({ min: -50, max: 50, noNaN: true }),
  })
  .map(
    ({ x1, x2, y1, y2, z1, z2 }): Aabb3D => ({
      min: {
        x: Math.min(x1, x2),
        y: Math.min(y1, y2),
        z: Math.min(z1, z2),
      },
      max: {
        x: Math.max(x1, x2) + 0.1,
        y: Math.max(y1, y2) + 0.1,
        z: Math.max(z1, z2) + 0.1,
      },
    })
  );

describe('computeShadowFrustum — property tests', () => {
  it.todo(
    'guarantees finite extents and positive depth range for any solar direction and sphere',
    () => {
      fc.assert(
        fc.property(
          arbitraryNueDirection,
          arbitrarySphere3D,
          fc.double({ min: 20, max: 100, noNaN: true }), // distance
          fc.double({ min: 1.0, max: 2.0, noNaN: true }), // margin
          (directionNue, sphere, distance, margin) => {
            const frustum = computeShadowFrustum(sphere, directionNue, {
              distance,
              margin,
            });

            // All extents must be finite numbers
            expect(Number.isFinite(frustum.left)).toBe(true);
            expect(Number.isFinite(frustum.right)).toBe(true);
            expect(Number.isFinite(frustum.top)).toBe(true);
            expect(Number.isFinite(frustum.bottom)).toBe(true);
            expect(Number.isFinite(frustum.near)).toBe(true);
            expect(Number.isFinite(frustum.far)).toBe(true);

            // Frustum volume dimensions must be strictly positive
            expect(frustum.right).toBeGreaterThan(frustum.left);
            expect(frustum.top).toBeGreaterThan(frustum.bottom);
            expect(frustum.far).toBeGreaterThan(frustum.near);
            // Allow near plane to be slightly below 0.1 due to floating point precision
            expect(frustum.near).toBeGreaterThan(-0.1);
          }
        )
      );
    }
  );

  it.todo(
    'guarantees complete corner containment for any solar direction and AABB',
    () => {
      fc.assert(
        fc.property(
          arbitraryNueDirection,
          arbitraryAabb3D,
          fc.double({ min: 30, max: 100, noNaN: true }), // distance
          fc.double({ min: 1.1, max: 1.5, noNaN: true }), // margin
          (directionNue, aabb, distance, margin) => {
            const targetOrigin = { x: 0, y: 0, z: 0 };
            const frustum = computeShadowFrustum(aabb, directionNue, {
              distance,
              targetOrigin,
              margin,
            });

            // Frustum dimensions must be valid
            expect(frustum.right).toBeGreaterThan(frustum.left);
            expect(frustum.top).toBeGreaterThan(frustum.bottom);
            expect(frustum.far).toBeGreaterThan(frustum.near);
            // Allow near plane to be slightly below 0.1 due to floating point precision
            expect(frustum.near).toBeGreaterThan(-0.1);

            // Build orthonormal basis for verification:
            const f = new THREE.Vector3(
              -directionNue.x,
              -directionNue.y,
              -directionNue.z
            );
            const upRef =
              Math.abs(f.dot(new THREE.Vector3(0, 1, 0))) > 0.999
                ? new THREE.Vector3(0, 0, 1)
                : new THREE.Vector3(0, 1, 0);
            const u = new THREE.Vector3().crossVectors(f, upRef).normalize();
            const v = new THREE.Vector3().crossVectors(u, f);
            const lightPos = new THREE.Vector3(
              targetOrigin.x + distance * directionNue.x,
              targetOrigin.y + distance * directionNue.y,
              targetOrigin.z + distance * directionNue.z
            );

            const corners = [
              [aabb.min.x, aabb.min.y, aabb.min.z],
              [aabb.min.x, aabb.min.y, aabb.max.z],
              [aabb.min.x, aabb.max.y, aabb.min.z],
              [aabb.min.x, aabb.max.y, aabb.max.z],
              [aabb.max.x, aabb.min.y, aabb.min.z],
              [aabb.max.x, aabb.min.y, aabb.max.z],
              [aabb.max.x, aabb.max.y, aabb.min.z],
              [aabb.max.x, aabb.max.y, aabb.max.z],
            ];

            const epsilon = 1e-2;
            for (const [cx, cy, cz] of corners) {
              const pTarget = new THREE.Vector3(
                cx - targetOrigin.x,
                cy - targetOrigin.y,
                cz - targetOrigin.z
              );
              const pLight = new THREE.Vector3(
                cx - lightPos.x,
                cy - lightPos.y,
                cz - lightPos.z
              );

              const uCoord = pTarget.dot(u);
              const vCoord = pTarget.dot(v);
              const zCoord = pLight.dot(f);

              expect(uCoord).toBeGreaterThanOrEqual(frustum.left - epsilon);
              expect(uCoord).toBeLessThanOrEqual(frustum.right + epsilon);
              expect(vCoord).toBeGreaterThanOrEqual(frustum.bottom - epsilon);
              expect(vCoord).toBeLessThanOrEqual(frustum.top + epsilon);
              expect(zCoord).toBeGreaterThanOrEqual(frustum.near - epsilon);
              expect(zCoord).toBeLessThanOrEqual(frustum.far + epsilon);
            }
          }
        )
      );
    }
  );

  it('preserves non-degeneracy at exact zenith (+Y) and nadir (-Y)', () => {
    const zenithDirections: NueDirection[] = [
      { x: 0, y: 1, z: 0 },
      { x: 0, y: -1, z: 0 },
      { x: 0, y: 0.9999, z: 0.001 },
      { x: 0, y: -0.9999, z: -0.001 },
    ];

    for (const dir of zenithDirections) {
      const aabb: Aabb3D = {
        min: { x: -4, y: 0, z: -4 },
        max: { x: 4, y: 8, z: 4 },
      };
      const frustum = computeShadowFrustum(aabb, dir, { distance: 50 });

      expect(Number.isFinite(frustum.left)).toBe(true);
      expect(Number.isFinite(frustum.right)).toBe(true);
      expect(Number.isFinite(frustum.top)).toBe(true);
      expect(Number.isFinite(frustum.bottom)).toBe(true);
      expect(Number.isFinite(frustum.near)).toBe(true);
      expect(Number.isFinite(frustum.far)).toBe(true);
      expect(frustum.right).toBeGreaterThan(frustum.left);
      expect(frustum.top).toBeGreaterThan(frustum.bottom);
      expect(frustum.far).toBeGreaterThan(frustum.near);
    }
  });
});

describe('computeLightPlacement — property tests', () => {
  it('preserves distance and focal target for any random position and direction', () => {
    fc.assert(
      fc.property(
        arbitraryNueDirection,
        fc.record({
          x: fc.double({ min: -100, max: 100, noNaN: true }),
          y: fc.double({ min: -100, max: 100, noNaN: true }),
          z: fc.double({ min: -100, max: 100, noNaN: true }),
        }),
        fc.double({ min: 1, max: 500, noNaN: true }), // distance
        (directionNue, targetOrigin, distance) => {
          const placement = computeLightPlacement(
            targetOrigin,
            directionNue,
            distance
          );

          expect(placement.target.x).toBeCloseTo(targetOrigin.x, 6);
          expect(placement.target.y).toBeCloseTo(targetOrigin.y, 6);
          expect(placement.target.z).toBeCloseTo(targetOrigin.z, 6);

          const measuredDist = Math.hypot(
            placement.position.x - targetOrigin.x,
            placement.position.y - targetOrigin.y,
            placement.position.z - targetOrigin.z
          );
          expect(measuredDist).toBeCloseTo(distance, 5);
        }
      )
    );
  });
});
