import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { NueDirection } from '../geo/sun-position.js';
import { computeSunDiscWorldPosition } from './sun-disc-placement.js';
import {
  DEFAULT_VISIBLE_SUN_DISC,
  createVisibleSunDisc,
} from './visible-sun-disc.js';

const DECIMAL_PLACES = 12;
const FORWARD_ABOVE: NueDirection = {
  x: 0,
  y: Math.SQRT1_2,
  z: -Math.SQRT1_2,
};
const FORWARD_BELOW: NueDirection = {
  x: 0,
  y: -Math.SQRT1_2,
  z: -Math.SQRT1_2,
};

function createCamera(): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(90, 1, 0.1, 100);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  return camera;
}

function updateWorldMatrices(
  parent: THREE.Object3D,
  camera: THREE.Object3D
): void {
  parent.updateMatrixWorld(true);
  camera.updateMatrixWorld(true);
}

function expectVectorCloseTo(
  actual: THREE.Vector3,
  expected: Readonly<{ x: number; y: number; z: number }>
): void {
  expect(actual.x).toBeCloseTo(expected.x, DECIMAL_PLACES);
  expect(actual.y).toBeCloseTo(expected.y, DECIMAL_PLACES);
  expect(actual.z).toBeCloseTo(expected.z, DECIMAL_PLACES);
}

function expectQuaternionEquivalent(
  actual: THREE.Quaternion,
  expected: THREE.Quaternion
): void {
  expect(Math.abs(actual.dot(expected))).toBeCloseTo(1, DECIMAL_PLACES);
}

describe('createVisibleSunDisc', () => {
  it('creates exactly one named Three.js mesh on the supplied parent', () => {
    const parent = new THREE.Group();
    const sunDisc = createVisibleSunDisc(parent);

    expect(parent.children).toHaveLength(1);
    expect(parent.children[0]).toBe(sunDisc.object);
    expect(sunDisc.object).toBeInstanceOf(THREE.Mesh);
    expect(sunDisc.object.name).toBe('visible-sun-disc');
    expect(sunDisc.object.geometry).toBeInstanceOf(THREE.CircleGeometry);
    expect(sunDisc.object.material).toBeInstanceOf(THREE.MeshBasicMaterial);
  });

  it('uses the documented default options', () => {
    const sunDisc = createVisibleSunDisc(new THREE.Group());

    expect(sunDisc.object.geometry.parameters.radius).toBeCloseTo(
      DEFAULT_VISIBLE_SUN_DISC.diameter / 2,
      DECIMAL_PLACES
    );
    expect(sunDisc.object.material.color.getHex()).toBe(
      new THREE.Color(DEFAULT_VISIBLE_SUN_DISC.color).getHex()
    );

    const camera = createCamera();
    const state = sunDisc.update(FORWARD_BELOW, camera);

    expect(DEFAULT_VISIBLE_SUN_DISC.showBelowHorizon).toBe(false);
    expect(state).toBe('below-horizon');
    expect(sunDisc.object.visible).toBe(false);
  });

  it('applies configurable distance, diameter, and color options', () => {
    const parent = new THREE.Group();
    const camera = createCamera();
    const distance = 25;
    const diameter = 1.25;
    const color = '#ff8800';
    const sunDisc = createVisibleSunDisc(parent, {
      distance,
      diameter,
      color,
    });

    updateWorldMatrices(parent, camera);
    sunDisc.update(FORWARD_ABOVE, camera);

    expect(sunDisc.object.geometry.parameters.radius).toBeCloseTo(
      diameter / 2,
      DECIMAL_PLACES
    );
    expect(sunDisc.object.material.color.getHex()).toBe(
      new THREE.Color(color).getHex()
    );
    expectVectorCloseTo(
      sunDisc.object.position,
      computeSunDiscWorldPosition(
        { x: 0, y: 0, z: 0 },
        FORWARD_ABOVE,
        distance
      )
    );
  });

  it('uses the shared placement result for the current camera position', () => {
    const parent = new THREE.Group();
    const camera = createCamera();
    camera.position.set(3, 4, 5);
    const sunDisc = createVisibleSunDisc(parent);
    updateWorldMatrices(parent, camera);

    sunDisc.update(FORWARD_ABOVE, camera);

    expectVectorCloseTo(
      sunDisc.object.position,
      computeSunDiscWorldPosition(
        { x: 3, y: 4, z: 5 },
        FORWARD_ABOVE,
        DEFAULT_VISIBLE_SUN_DISC.distance
      )
    );
  });

  it('billboards the disc using the supplied camera world orientation', () => {
    const parent = new THREE.Group();
    const cameraRig = new THREE.Group();
    const camera = createCamera();
    cameraRig.rotation.set(0.2, -0.4, 0.1);
    cameraRig.add(camera);
    const sunDisc = createVisibleSunDisc(parent);
    updateWorldMatrices(parent, cameraRig);

    sunDisc.update(FORWARD_ABOVE, camera);

    const expectedWorldQuaternion = new THREE.Quaternion();
    camera.getWorldQuaternion(expectedWorldQuaternion);
    expectQuaternionEquivalent(sunDisc.object.quaternion, expectedWorldQuaternion);
  });

  it('is visible when above the horizon and inside the camera frustum', () => {
    const parent = new THREE.Group();
    const camera = createCamera();
    const sunDisc = createVisibleSunDisc(parent);
    updateWorldMatrices(parent, camera);

    expect(sunDisc.update(FORWARD_ABOVE, camera)).toBe('visible');
    expect(sunDisc.object.visible).toBe(true);
  });

  it.each([
    { name: 'left', directionNue: { x: -0.995, y: 0.01, z: -0.099 } },
    { name: 'right', directionNue: { x: 0.995, y: 0.01, z: -0.099 } },
    { name: 'top', directionNue: { x: 0, y: 0.995, z: -0.1 } },
    { name: 'behind', directionNue: { x: 0, y: 0.1, z: 0.995 } },
  ] satisfies ReadonlyArray<{ name: string; directionNue: NueDirection }>)(
    'returns outside-view for an above-horizon direction beyond the $name of the frustum',
    ({ directionNue }) => {
      const parent = new THREE.Group();
      const camera = createCamera();
      const sunDisc = createVisibleSunDisc(parent, { diameter: 0.1 });
      updateWorldMatrices(parent, camera);

      expect(sunDisc.update(directionNue, camera)).toBe('outside-view');
      expect(sunDisc.object.visible).toBe(false);
    }
  );

  it('counts a disc intersecting a frustum edge as visible', () => {
    const parent = new THREE.Group();
    const camera = createCamera();
    const edgeDirection: NueDirection = {
      x: 1 / Math.sqrt(2),
      y: 0.001,
      z: -1 / Math.sqrt(2),
    };
    const sunDisc = createVisibleSunDisc(parent, { diameter: 1 });
    updateWorldMatrices(parent, camera);

    expect(sunDisc.update(edgeDirection, camera)).toBe('visible');
    expect(sunDisc.object.visible).toBe(true);
  });

  it('parks a below-horizon disc at its placement while hiding it', () => {
    const parent = new THREE.Group();
    const camera = createCamera();
    camera.position.set(-2, 3, 7);
    const sunDisc = createVisibleSunDisc(parent);
    updateWorldMatrices(parent, camera);

    expect(sunDisc.update(FORWARD_BELOW, camera)).toBe('below-horizon');
    expect(sunDisc.object.visible).toBe(false);
    expectVectorCloseTo(
      sunDisc.object.position,
      computeSunDiscWorldPosition(
        { x: -2, y: 3, z: 7 },
        FORWARD_BELOW,
        DEFAULT_VISIBLE_SUN_DISC.distance
      )
    );
  });

  it('showBelowHorizon bypasses only the horizon rule', () => {
    const parent = new THREE.Group();
    const camera = createCamera();
    const sunDisc = createVisibleSunDisc(parent, { showBelowHorizon: true });
    updateWorldMatrices(parent, camera);

    expect(sunDisc.update(FORWARD_BELOW, camera)).toBe('visible');
    expect(sunDisc.object.visible).toBe(true);

    expect(
      sunDisc.update({ x: 0, y: -0.1, z: 0.995 }, camera)
    ).toBe('outside-view');
    expect(sunDisc.object.visible).toBe(false);
  });

  it('reuses one mesh across day to night to day transitions', () => {
    const parent = new THREE.Group();
    const camera = createCamera();
    const sunDisc = createVisibleSunDisc(parent);
    const originalMesh = sunDisc.object;
    const originalGeometry = sunDisc.object.geometry;
    const originalMaterial = sunDisc.object.material;
    updateWorldMatrices(parent, camera);

    expect(sunDisc.update(FORWARD_ABOVE, camera)).toBe('visible');
    expect(sunDisc.update(FORWARD_BELOW, camera)).toBe('below-horizon');
    expect(sunDisc.update(FORWARD_ABOVE, camera)).toBe('visible');

    expect(sunDisc.object).toBe(originalMesh);
    expect(sunDisc.object.geometry).toBe(originalGeometry);
    expect(sunDisc.object.material).toBe(originalMaterial);
    expect(parent.children).toEqual([originalMesh]);
  });

  it('updates placement when the camera moves', () => {
    const parent = new THREE.Group();
    const camera = createCamera();
    const sunDisc = createVisibleSunDisc(parent);
    updateWorldMatrices(parent, camera);
    sunDisc.update(FORWARD_ABOVE, camera);
    const before = sunDisc.object.position.clone();

    camera.position.set(6, -1, 2);
    updateWorldMatrices(parent, camera);
    sunDisc.update(FORWARD_ABOVE, camera);

    expect(sunDisc.object.position.equals(before)).toBe(false);
    expectVectorCloseTo(
      sunDisc.object.position,
      computeSunDiscWorldPosition(
        { x: 6, y: -1, z: 2 },
        FORWARD_ABOVE,
        DEFAULT_VISIBLE_SUN_DISC.distance
      )
    );
  });

  it('updates billboard orientation and view state when the camera rotates', () => {
    const parent = new THREE.Group();
    const camera = createCamera();
    const sunDisc = createVisibleSunDisc(parent);
    updateWorldMatrices(parent, camera);

    expect(sunDisc.update(FORWARD_ABOVE, camera)).toBe('visible');
    const positionBeforeRotation = sunDisc.object.position.clone();

    camera.rotateY(Math.PI);
    updateWorldMatrices(parent, camera);

    expect(sunDisc.update(FORWARD_ABOVE, camera)).toBe('outside-view');
    expectVectorCloseTo(sunDisc.object.position, positionBeforeRotation);
    const expectedWorldQuaternion = new THREE.Quaternion();
    camera.getWorldQuaternion(expectedWorldQuaternion);
    expectQuaternionEquivalent(sunDisc.object.quaternion, expectedWorldQuaternion);
  });

  it('does not create objects or replace resources during repeated updates', () => {
    const parent = new THREE.Group();
    const camera = createCamera();
    const sunDisc = createVisibleSunDisc(parent);
    const originalChildren = [...parent.children];
    const originalGeometry = sunDisc.object.geometry;
    const originalMaterial = sunDisc.object.material;
    updateWorldMatrices(parent, camera);

    for (let index = 0; index < 20; index += 1) {
      sunDisc.update(index % 2 === 0 ? FORWARD_ABOVE : FORWARD_BELOW, camera);
    }

    expect(parent.children).toEqual(originalChildren);
    expect(sunDisc.object.geometry).toBe(originalGeometry);
    expect(sunDisc.object.material).toBe(originalMaterial);
  });

  it.each([
    { option: 'distance', value: 0 },
    { option: 'distance', value: -1 },
    { option: 'distance', value: Number.NaN },
    { option: 'distance', value: Number.POSITIVE_INFINITY },
    { option: 'diameter', value: 0 },
    { option: 'diameter', value: -1 },
    { option: 'diameter', value: Number.NaN },
    { option: 'diameter', value: Number.POSITIVE_INFINITY },
  ] as const)('rejects invalid $option $value', ({ option, value }) => {
    expect(() =>
      createVisibleSunDisc(new THREE.Group(), { [option]: value })
    ).toThrow();
  });

  it('detaches the mesh and disposes its owned resources', () => {
    const parent = new THREE.Group();
    const sunDisc = createVisibleSunDisc(parent);
    const geometryDispose = vi.spyOn(sunDisc.object.geometry, 'dispose');
    const materialDispose = vi.spyOn(sunDisc.object.material, 'dispose');

    sunDisc.dispose();

    expect(parent.children).not.toContain(sunDisc.object);
    expect(sunDisc.object.parent).toBeNull();
    expect(geometryDispose).toHaveBeenCalledOnce();
    expect(materialDispose).toHaveBeenCalledOnce();
  });

  it('keeps multiple instances and their disposal independent', () => {
    const parent = new THREE.Group();
    const first = createVisibleSunDisc(parent);
    const second = createVisibleSunDisc(parent, { color: 0xff0000 });
    const firstGeometryDispose = vi.spyOn(first.object.geometry, 'dispose');
    const secondGeometryDispose = vi.spyOn(second.object.geometry, 'dispose');

    expect(parent.children).toEqual([first.object, second.object]);
    expect(first.object.geometry).not.toBe(second.object.geometry);
    expect(first.object.material).not.toBe(second.object.material);

    first.dispose();

    expect(parent.children).toEqual([second.object]);
    expect(firstGeometryDispose).toHaveBeenCalledOnce();
    expect(secondGeometryDispose).not.toHaveBeenCalled();

    second.dispose();

    expect(parent.children).toHaveLength(0);
    expect(secondGeometryDispose).toHaveBeenCalledOnce();
  });
});
