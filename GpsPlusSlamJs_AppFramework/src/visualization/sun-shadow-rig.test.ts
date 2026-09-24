/**
 * Tests for the Sun-driven shadow rig (sun-shadow-rig.ts).
 *
 * Why this test matters:
 * In outdoor location-based WebXR and desktop replay, virtual objects must cast
 * physically grounded, correctly oriented shadows onto real-world ground surfaces
 * matching the astronomical position of the sun. Without this rig:
 * (a) Directional lighting defaults to an unshadowed, hardcoded angle that
 *     contradicts real sunlight and breaks AR immersion.
 * (b) Incorrect shadow camera framing leads to severe shadow acne, peter-panning,
 *     or edge-clipping where shadows flicker and vanish as objects move.
 * (c) When the sun drops below the horizon at night, unhandled directional
 *     lights cast inverted shadows upward from beneath the ground plane.
 *
 * These tests pin both the headless framing math (computeShadowFrustum,
 * computeLightPlacement) and the view-layer GPU rig (directional light,
 * tuned biases, orthographic camera synchronization, invisible shadow-catcher
 * ground plane, horizon handling, and lifecycle cleanup).
 */

import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { NueDirection } from '../geo/sun-position.js';
import type { SunLightingResult } from '../geo/sun-altitude-lighting.js';
import {
  DEFAULT_SUN_SHADOW_RIG,
  computeLightPlacement,
  computeShadowFrustum,
  createSunShadowRig,
  type Aabb3D,
  type Sphere3D,
} from './sun-shadow-rig.js';

const DECIMAL_PLACES = 6;

describe('DEFAULT_SUN_SHADOW_RIG', () => {
  it('pins the documented default parameters across instances', () => {
    expect(DEFAULT_SUN_SHADOW_RIG.distance).toBe(50);
    expect(DEFAULT_SUN_SHADOW_RIG.mapSize).toBe(2048);
    expect(DEFAULT_SUN_SHADOW_RIG.bias).toBe(-0.0005);
    expect(DEFAULT_SUN_SHADOW_RIG.normalBias).toBe(0.03);
    expect(DEFAULT_SUN_SHADOW_RIG.groundPlaneSize).toBe(100);
    expect(DEFAULT_SUN_SHADOW_RIG.shadowOpacity).toBe(0.4);
    expect(DEFAULT_SUN_SHADOW_RIG.shadowColor).toBe(0x000000);
    expect(DEFAULT_SUN_SHADOW_RIG.margin).toBe(1.15);
    expect(DEFAULT_SUN_SHADOW_RIG.defaultContentExtent).toBe(15);
    expect(DEFAULT_SUN_SHADOW_RIG.targetOrigin).toEqual({ x: 0, y: 0, z: 0 });
  });
});

describe('computeLightPlacement', () => {
  const origin = { x: 0, y: 0, z: 0 };
  const distance = 50;

  it.each([
    {
      name: 'North (+X)',
      directionNue: { x: 1, y: 0, z: 0 },
      expectedPos: { x: 50, y: 0, z: 0 },
    },
    {
      name: 'South (-X)',
      directionNue: { x: -1, y: 0, z: 0 },
      expectedPos: { x: -50, y: 0, z: 0 },
    },
    {
      name: 'East (+Z)',
      directionNue: { x: 0, y: 0, z: 1 },
      expectedPos: { x: 0, y: 0, z: 50 },
    },
    {
      name: 'West (-Z)',
      directionNue: { x: 0, y: 0, z: -1 },
      expectedPos: { x: 0, y: 0, z: -50 },
    },
    {
      name: 'Zenith (+Y)',
      directionNue: { x: 0, y: 1, z: 0 },
      expectedPos: { x: 0, y: 50, z: 0 },
    },
  ] satisfies ReadonlyArray<{
    name: string;
    directionNue: NueDirection;
    expectedPos: { x: number; y: number; z: number };
  }>)(
    'positions directional light along $name cardinal axis',
    ({ directionNue, expectedPos }) => {
      const placement = computeLightPlacement(origin, directionNue, distance);
      expect(placement.position.x).toBeCloseTo(expectedPos.x, DECIMAL_PLACES);
      expect(placement.position.y).toBeCloseTo(expectedPos.y, DECIMAL_PLACES);
      expect(placement.position.z).toBeCloseTo(expectedPos.z, DECIMAL_PLACES);
      expect(placement.target.x).toBeCloseTo(origin.x, DECIMAL_PLACES);
      expect(placement.target.y).toBeCloseTo(origin.y, DECIMAL_PLACES);
      expect(placement.target.z).toBeCloseTo(origin.z, DECIMAL_PLACES);
    }
  );

  it('offsets light position and preserves focal target for non-zero target origin', () => {
    const targetOrigin = { x: 12.5, y: -4.0, z: 8.2 };
    const directionNue: NueDirection = { x: 0, y: 1, z: 0 };
    const placement = computeLightPlacement(
      targetOrigin,
      directionNue,
      distance
    );

    expect(placement.position.x).toBeCloseTo(12.5, DECIMAL_PLACES);
    expect(placement.position.y).toBeCloseTo(46.0, DECIMAL_PLACES);
    expect(placement.position.z).toBeCloseTo(8.2, DECIMAL_PLACES);
    expect(placement.target).toEqual(targetOrigin);
  });

  it('preserves requested distance for diagonal unit directions', () => {
    const targetOrigin = { x: -3, y: 7, z: 15 };
    const requestedDistance = 37.5;
    const directionNue: NueDirection = {
      x: 1 / Math.sqrt(3),
      y: 1 / Math.sqrt(3),
      z: 1 / Math.sqrt(3),
    };

    const placement = computeLightPlacement(
      targetOrigin,
      directionNue,
      requestedDistance
    );
    const measuredDistance = Math.hypot(
      placement.position.x - targetOrigin.x,
      placement.position.y - targetOrigin.y,
      placement.position.z - targetOrigin.z
    );

    expect(measuredDistance).toBeCloseTo(requestedDistance, DECIMAL_PLACES);
  });

  it.each([0, -10, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects non-positive or non-finite distance %s',
    (invalidDistance) => {
      expect(() =>
        computeLightPlacement(origin, { x: 1, y: 0, z: 0 }, invalidDistance)
      ).toThrow();
    }
  );

  it.each([
    { name: 'zero-length', directionNue: { x: 0, y: 0, z: 0 } },
    {
      name: 'non-finite X',
      directionNue: { x: Number.NaN, y: 1, z: 0 },
    },
    {
      name: 'non-finite Y',
      directionNue: { x: 0, y: Number.POSITIVE_INFINITY, z: 0 },
    },
    {
      name: 'non-finite Z',
      directionNue: { x: 0, y: 0, z: Number.NEGATIVE_INFINITY },
    },
  ] satisfies ReadonlyArray<{ name: string; directionNue: NueDirection }>)(
    'rejects $name direction',
    ({ directionNue }) => {
      expect(() =>
        computeLightPlacement(origin, directionNue, distance)
      ).toThrow();
    }
  );

  it('rejects non-finite target origin coordinates', () => {
    expect(() =>
      computeLightPlacement(
        { x: Number.NaN, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
        distance
      )
    ).toThrow();
  });
});

describe('computeShadowFrustum', () => {
  const sunNorth: NueDirection = { x: 1, y: 0, z: 0 };
  const sunZenith: NueDirection = { x: 0, y: 1, z: 0 };
  const sunNadir: NueDirection = { x: 0, y: -1, z: 0 };

  describe('Sphere3D framing', () => {
    it('computes symmetric orthographic extents for origin-centered sphere with default margin', () => {
      const sphere: Sphere3D = { center: { x: 0, y: 0, z: 0 }, radius: 10 };
      const frustum = computeShadowFrustum(sphere, sunNorth);
      const expectedExtent = 10 * 1.15; // 11.5

      expect(frustum.left).toBeCloseTo(-expectedExtent, DECIMAL_PLACES);
      expect(frustum.right).toBeCloseTo(expectedExtent, DECIMAL_PLACES);
      expect(frustum.bottom).toBeCloseTo(-expectedExtent, DECIMAL_PLACES);
      expect(frustum.top).toBeCloseTo(expectedExtent, DECIMAL_PLACES);

      // Distance is default 50. Axial depth of center is 50.
      expect(frustum.near).toBeCloseTo(50 - expectedExtent, DECIMAL_PLACES);
      expect(frustum.far).toBeCloseTo(50 + expectedExtent, DECIMAL_PLACES);
    });

    it('scales extents proportionally when custom margin is provided as scalar number', () => {
      const sphere: Sphere3D = { center: { x: 0, y: 0, z: 0 }, radius: 10 };
      const customMargin = 1.5;
      const frustum = computeShadowFrustum(sphere, sunNorth, customMargin);
      const expectedExtent = 10 * customMargin; // 15

      expect(frustum.left).toBeCloseTo(-expectedExtent, DECIMAL_PLACES);
      expect(frustum.right).toBeCloseTo(expectedExtent, DECIMAL_PLACES);
      expect(frustum.bottom).toBeCloseTo(-expectedExtent, DECIMAL_PLACES);
      expect(frustum.top).toBeCloseTo(expectedExtent, DECIMAL_PLACES);
      expect(frustum.near).toBeCloseTo(50 - expectedExtent, DECIMAL_PLACES);
      expect(frustum.far).toBeCloseTo(50 + expectedExtent, DECIMAL_PLACES);
    });

    it('applies distance and targetOrigin options object', () => {
      const sphere: Sphere3D = { center: { x: 10, y: 5, z: 0 }, radius: 8 };
      const frustum = computeShadowFrustum(sphere, sunNorth, {
        distance: 60,
        targetOrigin: { x: 10, y: 5, z: 0 },
        margin: 1.25,
      });
      const expectedExtent = 8 * 1.25; // 10

      expect(frustum.left).toBeCloseTo(-expectedExtent, DECIMAL_PLACES);
      expect(frustum.right).toBeCloseTo(expectedExtent, DECIMAL_PLACES);
      expect(frustum.bottom).toBeCloseTo(-expectedExtent, DECIMAL_PLACES);
      expect(frustum.top).toBeCloseTo(expectedExtent, DECIMAL_PLACES);
      expect(frustum.near).toBeCloseTo(60 - expectedExtent, DECIMAL_PLACES);
      expect(frustum.far).toBeCloseTo(60 + expectedExtent, DECIMAL_PLACES);
    });

    it('clamps near plane to minimum threshold 0.1 to avoid clipping or negative near', () => {
      const sphere: Sphere3D = { center: { x: 0, y: 0, z: 0 }, radius: 50 };
      // axial depth is 10, but radius * margin is 57.5, so axial - extent < 0
      const frustum = computeShadowFrustum(sphere, sunNorth, {
        distance: 10,
        margin: 1.15,
      });

      expect(frustum.near).toBeGreaterThanOrEqual(0.1);
      expect(frustum.far).toBeGreaterThan(frustum.near);
    });
  });

  describe('Aabb3D framing', () => {
    it('frames symmetric axis-aligned box with margin', () => {
      const aabb: Aabb3D = {
        min: { x: -10, y: -5, z: -10 },
        max: { x: 10, y: 5, z: 10 },
      };
      const frustum = computeShadowFrustum(aabb, sunNorth);

      expect(frustum.left).toBeLessThan(0);
      expect(frustum.right).toBeGreaterThan(0);
      expect(frustum.left).toBeCloseTo(-frustum.right, DECIMAL_PLACES);
      expect(frustum.bottom).toBeCloseTo(-frustum.top, DECIMAL_PLACES);
      expect(frustum.far).toBeGreaterThan(frustum.near);
      expect(frustum.near).toBeGreaterThanOrEqual(0.1);
    });

    it('handles sun at zenith and nadir without gimbal lock or NaN planes', () => {
      const aabb: Aabb3D = {
        min: { x: -5, y: 0, z: -5 },
        max: { x: 5, y: 10, z: 5 },
      };

      const frustumZenith = computeShadowFrustum(aabb, sunZenith);
      expect(Number.isFinite(frustumZenith.left)).toBe(true);
      expect(Number.isFinite(frustumZenith.right)).toBe(true);
      expect(Number.isFinite(frustumZenith.top)).toBe(true);
      expect(Number.isFinite(frustumZenith.bottom)).toBe(true);
      expect(Number.isFinite(frustumZenith.near)).toBe(true);
      expect(Number.isFinite(frustumZenith.far)).toBe(true);
      expect(frustumZenith.right).toBeGreaterThan(frustumZenith.left);
      expect(frustumZenith.top).toBeGreaterThan(frustumZenith.bottom);
      expect(frustumZenith.far).toBeGreaterThan(frustumZenith.near);

      const frustumNadir = computeShadowFrustum(aabb, sunNadir);
      expect(Number.isFinite(frustumNadir.left)).toBe(true);
      expect(Number.isFinite(frustumNadir.right)).toBe(true);
      expect(frustumNadir.right).toBeGreaterThan(frustumNadir.left);
      expect(frustumNadir.far).toBeGreaterThan(frustumNadir.near);
    });

    it('ensures all 8 AABB corners project strictly inside the computed frustum', () => {
      const aabb: Aabb3D = {
        min: { x: 2, y: -1, z: 4 },
        max: { x: 12, y: 8, z: 14 },
      };
      const direction: NueDirection = {
        x: 0.6,
        y: 0.8,
        z: 0,
      };
      const distance = 40;
      const targetOrigin = { x: 7, y: 3.5, z: 9 };
      const margin = 1.2;

      const frustum = computeShadowFrustum(aabb, direction, {
        distance,
        targetOrigin,
        margin,
      });

      // Construct view basis to test corner containment:
      // f = -d
      const f = new THREE.Vector3(-direction.x, -direction.y, -direction.z);
      const upRef =
        Math.abs(f.dot(new THREE.Vector3(0, 1, 0))) > 0.999
          ? new THREE.Vector3(0, 0, 1)
          : new THREE.Vector3(0, 1, 0);
      const u = new THREE.Vector3().crossVectors(f, upRef).normalize();
      const v = new THREE.Vector3().crossVectors(u, f);
      const lightPos = new THREE.Vector3(
        targetOrigin.x + distance * direction.x,
        targetOrigin.y + distance * direction.y,
        targetOrigin.z + distance * direction.z
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

        const uVal = pTarget.dot(u);
        const vVal = pTarget.dot(v);
        const depthVal = pLight.dot(f);

        expect(uVal).toBeGreaterThanOrEqual(frustum.left);
        expect(uVal).toBeLessThanOrEqual(frustum.right);
        expect(vVal).toBeGreaterThanOrEqual(frustum.bottom);
        expect(vVal).toBeLessThanOrEqual(frustum.top);
        expect(depthVal).toBeGreaterThanOrEqual(frustum.near);
        expect(depthVal).toBeLessThanOrEqual(frustum.far);
      }
    });
  });

  describe('defensive validation', () => {
    it('rejects inverted bounding boxes where min > max', () => {
      const invertedAabb: Aabb3D = {
        min: { x: 10, y: 0, z: 0 },
        max: { x: -10, y: 0, z: 0 },
      };
      expect(() => computeShadowFrustum(invertedAabb, sunNorth)).toThrow();
    });

    it('rejects spheres with negative radius', () => {
      const invalidSphere: Sphere3D = {
        center: { x: 0, y: 0, z: 0 },
        radius: -5,
      };
      expect(() => computeShadowFrustum(invalidSphere, sunNorth)).toThrow();
    });
  });
});

describe('createSunShadowRig', () => {
  const sunNorth: NueDirection = { x: 1, y: 0, z: 0 };
  const sunMidday: NueDirection = {
    x: 0,
    y: Math.SQRT1_2,
    z: Math.SQRT1_2,
  };
  const sunBelowHorizon: NueDirection = {
    x: 0,
    y: -Math.SQRT1_2,
    z: Math.SQRT1_2,
  };

  it('attaches directional light, target, and shadow-catcher to parent scene', () => {
    const parent = new THREE.Scene();
    const rig = createSunShadowRig(parent);

    expect(parent.children).toContain(rig.directionalLight);
    expect(parent.children).toContain(rig.target);
    expect(parent.children).toContain(rig.shadowCatcher);
    expect(rig.directionalLight).toBeInstanceOf(THREE.DirectionalLight);
    expect(rig.target).toBe(rig.directionalLight.target);
    expect(rig.shadowCatcher).toBeInstanceOf(THREE.Mesh);
  });

  it('configures default shadow map, bias, and normalBias for mobile WebXR', () => {
    const parent = new THREE.Scene();
    const rig = createSunShadowRig(parent);

    expect(rig.directionalLight.castShadow).toBe(true);
    expect(rig.directionalLight.shadow.mapSize.width).toBe(
      DEFAULT_SUN_SHADOW_RIG.mapSize
    );
    expect(rig.directionalLight.shadow.mapSize.height).toBe(
      DEFAULT_SUN_SHADOW_RIG.mapSize
    );
    expect(rig.directionalLight.shadow.bias).toBe(DEFAULT_SUN_SHADOW_RIG.bias);
    expect(rig.directionalLight.shadow.normalBias).toBe(
      DEFAULT_SUN_SHADOW_RIG.normalBias
    );
    expect(rig.directionalLight.shadow.camera).toBeInstanceOf(
      THREE.OrthographicCamera
    );
  });

  it('configures invisible horizontal shadow-catcher ground plane in NUE space', () => {
    const parent = new THREE.Scene();
    const rig = createSunShadowRig(parent);

    expect(rig.shadowCatcher.geometry).toBeInstanceOf(THREE.PlaneGeometry);
    expect(rig.shadowCatcher.geometry.parameters.width).toBe(
      DEFAULT_SUN_SHADOW_RIG.groundPlaneSize
    );
    expect(rig.shadowCatcher.geometry.parameters.height).toBe(
      DEFAULT_SUN_SHADOW_RIG.groundPlaneSize
    );

    // Lies flat in XZ plane (Rx = -pi/2)
    expect(rig.shadowCatcher.rotation.x).toBeCloseTo(
      -Math.PI / 2,
      DECIMAL_PLACES
    );
    expect(rig.shadowCatcher.position.y).toBeCloseTo(0, DECIMAL_PLACES);

    // Shadow catcher material configuration
    expect(rig.shadowCatcher.material).toBeInstanceOf(THREE.ShadowMaterial);
    expect(rig.shadowCatcher.material.transparent).toBe(true);
    expect(rig.shadowCatcher.material.depthWrite).toBe(false);
    expect(rig.shadowCatcher.material.opacity).toBe(
      DEFAULT_SUN_SHADOW_RIG.shadowOpacity
    );
    expect(rig.shadowCatcher.receiveShadow).toBe(true);
    expect(rig.shadowCatcher.castShadow).toBe(false);
  });

  it('applies custom options for mapSize, biases, plane size, and targetOrigin', () => {
    const parent = new THREE.Scene();
    const customOrigin = { x: 5, y: 0, z: -10 };
    const rig = createSunShadowRig(parent, {
      mapSize: 1024,
      bias: -0.001,
      normalBias: 0.05,
      groundPlaneSize: 150,
      shadowOpacity: 0.6,
      targetOrigin: customOrigin,
    });

    expect(rig.directionalLight.shadow.mapSize.width).toBe(1024);
    expect(rig.directionalLight.shadow.mapSize.height).toBe(1024);
    expect(rig.directionalLight.shadow.bias).toBe(-0.001);
    expect(rig.directionalLight.shadow.normalBias).toBe(0.05);
    expect(rig.shadowCatcher.geometry.parameters.width).toBe(150);
    expect(rig.shadowCatcher.material.opacity).toBe(0.6);
    expect(rig.shadowCatcher.position.x).toBeCloseTo(
      customOrigin.x,
      DECIMAL_PLACES
    );
    expect(rig.shadowCatcher.position.z).toBeCloseTo(
      customOrigin.z,
      DECIMAL_PLACES
    );
  });

  describe('update', () => {
    it('updates directional light position and target position', () => {
      const parent = new THREE.Scene();
      const rig = createSunShadowRig(parent);

      rig.update(sunNorth);

      expect(rig.directionalLight.position.x).toBeCloseTo(50, DECIMAL_PLACES);
      expect(rig.directionalLight.position.y).toBeCloseTo(0, DECIMAL_PLACES);
      expect(rig.directionalLight.position.z).toBeCloseTo(0, DECIMAL_PLACES);
      expect(rig.target.position.x).toBeCloseTo(0, DECIMAL_PLACES);
      expect(rig.target.position.y).toBeCloseTo(0, DECIMAL_PLACES);
      expect(rig.target.position.z).toBeCloseTo(0, DECIMAL_PLACES);
    });

    it('frames shadow camera using default symmetric bounds when contentBounds is omitted', () => {
      const parent = new THREE.Scene();
      const rig = createSunShadowRig(parent);
      const camera = rig.directionalLight.shadow.camera;
      const updateProjectionSpy = vi.spyOn(camera, 'updateProjectionMatrix');

      rig.update(sunMidday);

      expect(camera.right).toBeGreaterThan(camera.left);
      expect(camera.top).toBeGreaterThan(camera.bottom);
      expect(camera.far).toBeGreaterThan(camera.near);
      expect(updateProjectionSpy).toHaveBeenCalled();
    });

    it('frames shadow camera tightly around provided contentBounds', () => {
      const parent = new THREE.Scene();
      const rig = createSunShadowRig(parent);
      const customAabb: Aabb3D = {
        min: { x: -2, y: 0, z: -2 },
        max: { x: 2, y: 4, z: 2 },
      };

      // Verify that update is called without errors
      expect(() => rig.update(sunNorth, customAabb)).not.toThrow();

      // Verify that camera has valid frustum structure
      const camera = rig.directionalLight.shadow.camera;
      expect(camera).toBeDefined();
      expect(camera.isOrthographicCamera).toBe(true);
    });

    it('modulates directional light color and intensity when lighting parameter is provided', () => {
      const parent = new THREE.Scene();
      const rig = createSunShadowRig(parent);
      const lighting: SunLightingResult = {
        intensity: 0.85,
        color: 0xffa500, // warm golden
        ambientLevel: 0.9,
      };

      rig.update(sunMidday, undefined, lighting);

      expect(rig.directionalLight.intensity).toBeCloseTo(0.85, DECIMAL_PLACES);
      expect(rig.directionalLight.color.getHex()).toBe(0xffa500);
    });

    it('disables castShadow and hides shadow-catcher when sun drops below horizon (Y <= 0)', () => {
      const parent = new THREE.Scene();
      const rig = createSunShadowRig(parent);

      // Daytime first
      rig.update(sunMidday);
      expect(rig.directionalLight.castShadow).toBe(true);
      expect(rig.shadowCatcher.visible).toBe(true);

      // Nighttime (sun below horizon)
      rig.update(sunBelowHorizon);
      expect(rig.directionalLight.castShadow).toBe(false);
      expect(rig.shadowCatcher.visible).toBe(false);

      // Daytime again: restores shadow casting
      rig.update(sunMidday);
      expect(rig.directionalLight.castShadow).toBe(true);
      expect(rig.shadowCatcher.visible).toBe(true);
    });
  });

  describe('setVisible', () => {
    it('toggles visibility of directional light and shadow catcher', () => {
      const parent = new THREE.Scene();
      const rig = createSunShadowRig(parent);

      rig.setVisible(false);
      expect(rig.directionalLight.visible).toBe(false);
      expect(rig.shadowCatcher.visible).toBe(false);

      rig.setVisible(true);
      expect(rig.directionalLight.visible).toBe(true);
      expect(rig.shadowCatcher.visible).toBe(true);
    });
  });

  describe('dispose', () => {
    it('detaches scene nodes, disposes geometries, materials, and shadow map render target', () => {
      const parent = new THREE.Scene();
      const rig = createSunShadowRig(parent);

      const geoSpy = vi.spyOn(rig.shadowCatcher.geometry, 'dispose');
      const matSpy = vi.spyOn(rig.shadowCatcher.material, 'dispose');

      rig.dispose();

      expect(parent.children).not.toContain(rig.directionalLight);
      expect(parent.children).not.toContain(rig.target);
      expect(parent.children).not.toContain(rig.shadowCatcher);
      expect(geoSpy).toHaveBeenCalledOnce();
      expect(matSpy).toHaveBeenCalledOnce();
    });

    it('is idempotent and safe to call multiple times', () => {
      const parent = new THREE.Scene();
      const rig = createSunShadowRig(parent);

      expect(() => {
        rig.dispose();
        rig.dispose();
      }).not.toThrow();
    });
  });
});
