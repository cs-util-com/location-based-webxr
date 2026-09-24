/**
 * Sun-driven shadow rig for location-based WebXR and desktop replay.
 * Skeleton implementation for TDD.
 *
 * @see sun-shadow-rig.ts.md
 */

import * as THREE from 'three';
import type { NueDirection } from '../geo/sun-position.js';
import type { SunLightingResult } from '../geo/sun-altitude-lighting.js';

/** Axis-aligned 3D bounding box for shadow framing. */
export interface Aabb3D {
  readonly min: { readonly x: number; readonly y: number; readonly z: number };
  readonly max: { readonly x: number; readonly y: number; readonly z: number };
}

/** 3D bounding sphere for radial shadow framing. */
export interface Sphere3D {
  readonly center: {
    readonly x: number;
    readonly y: number;
    readonly z: number;
  };
  readonly radius: number;
}

/** Content volume passed to frame the shadow camera. */
export type ContentBounds = Aabb3D | Sphere3D;

/** Orthographic camera frustum extents in light view space. */
export interface ShadowFrustum {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
  readonly near: number;
  readonly far: number;
}

/** World-space positioning for a directional light shining at a target. */
export interface SunLightPlacement {
  readonly position: {
    readonly x: number;
    readonly y: number;
    readonly z: number;
  };
  readonly target: {
    readonly x: number;
    readonly y: number;
    readonly z: number;
  };
}

/** Configuration options for the Sun-driven shadow rig. */
export interface SunShadowRigOptions {
  readonly targetOrigin?: {
    readonly x: number;
    readonly y: number;
    readonly z: number;
  };
  readonly distance?: number;
  readonly mapSize?: number;
  readonly bias?: number;
  readonly normalBias?: number;
  readonly groundPlaneSize?: number;
  readonly shadowOpacity?: number;
  readonly shadowColor?: THREE.ColorRepresentation;
  readonly margin?: number;
  readonly defaultContentExtent?: number;
}

/** Lifecycle and update handle for the Sun-driven shadow rig. */
export interface SunShadowRig {
  readonly directionalLight: THREE.DirectionalLight;
  readonly shadowCatcher: THREE.Mesh<THREE.PlaneGeometry, THREE.ShadowMaterial>;
  readonly target: THREE.Object3D;

  update(
    directionNue: NueDirection,
    contentBounds?: ContentBounds,
    lighting?: SunLightingResult
  ): void;

  setVisible(visible: boolean): void;

  dispose(): void;
}

/** Module defaults pinned across instances. */
export const DEFAULT_SUN_SHADOW_RIG: Readonly<{
  distance: number;
  mapSize: number;
  bias: number;
  normalBias: number;
  groundPlaneSize: number;
  shadowOpacity: number;
  shadowColor: number;
  margin: number;
  defaultContentExtent: number;
  targetOrigin: { readonly x: number; readonly y: number; readonly z: number };
}> = Object.freeze({
  distance: 50,
  mapSize: 2048,
  bias: -0.0005,
  normalBias: 0.03,
  groundPlaneSize: 100,
  shadowOpacity: 0.4,
  shadowColor: 0x000000,
  margin: 1.15,
  defaultContentExtent: 15,
  targetOrigin: Object.freeze({ x: 0, y: 0, z: 0 }),
});

/**
 * Pure calculation: compute directional light world position shining towards a target.
 *
 * @param targetOrigin - Focal center of the scene (e.g. origin or user position).
 * @param directionNue - Normalized sun direction (+Y up, +X north, +Z east).
 * @param distance - Distance along the sun direction in metres.
 */
export function computeLightPlacement(
  targetOrigin: { readonly x: number; readonly y: number; readonly z: number },
  directionNue: NueDirection,
  distance: number
): SunLightPlacement {
  validateDistance(distance);
  validateDirection(directionNue);
  validateTargetOrigin(targetOrigin);

  return {
    position: {
      x: targetOrigin.x + distance * directionNue.x,
      y: targetOrigin.y + distance * directionNue.y,
      z: targetOrigin.z + distance * directionNue.z,
    },
    target: targetOrigin,
  };
}

function validateDistance(distance: number): void {
  if (!Number.isFinite(distance) || distance <= 0) {
    throw new RangeError('Distance must be a positive finite number');
  }
}

function validateDirection(directionNue: NueDirection): void {
  const magnitude = Math.hypot(directionNue.x, directionNue.y, directionNue.z);
  if (!Number.isFinite(magnitude) || magnitude === 0) {
    throw new TypeError('Direction must be a non-zero finite vector');
  }
  if (
    !Number.isFinite(directionNue.x) ||
    !Number.isFinite(directionNue.y) ||
    !Number.isFinite(directionNue.z)
  ) {
    throw new TypeError('Direction components must be finite');
  }
}

function validateTargetOrigin(targetOrigin: {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}): void {
  if (
    !Number.isFinite(targetOrigin.x) ||
    !Number.isFinite(targetOrigin.y) ||
    !Number.isFinite(targetOrigin.z)
  ) {
    throw new TypeError('Target origin coordinates must be finite');
  }
}

/** Configuration options for orthographic shadow frustum calculation. */
export interface ShadowFrustumOptions {
  readonly distance?: number;
  readonly targetOrigin?: {
    readonly x: number;
    readonly y: number;
    readonly z: number;
  };
  readonly margin?: number;
}

function parseFrustumOptions(options?: number | ShadowFrustumOptions): {
  distance: number;
  targetOrigin: { x: number; y: number; z: number };
  margin: number;
} {
  let distance = DEFAULT_SUN_SHADOW_RIG.distance;
  let targetOrigin = DEFAULT_SUN_SHADOW_RIG.targetOrigin;
  let margin = DEFAULT_SUN_SHADOW_RIG.margin;

  if (typeof options === 'number') {
    margin = options;
  } else if (options !== undefined) {
    distance = options.distance ?? DEFAULT_SUN_SHADOW_RIG.distance;
    targetOrigin = options.targetOrigin ?? DEFAULT_SUN_SHADOW_RIG.targetOrigin;
    margin = options.margin ?? DEFAULT_SUN_SHADOW_RIG.margin;
  }

  return { distance, targetOrigin, margin };
}

function validateMargin(margin: number): void {
  if (!Number.isFinite(margin) || margin < 1.0) {
    throw new RangeError('Margin must be a finite number >= 1.0');
  }
}

interface ViewBasis {
  readonly f: { x: number; y: number; z: number };
  readonly u: { x: number; y: number; z: number };
  readonly v: { x: number; y: number; z: number };
}

function computeViewBasis(directionNue: NueDirection): ViewBasis {
  const f = { x: -directionNue.x, y: -directionNue.y, z: -directionNue.z };

  const upRef =
    Math.abs(f.y) > 0.999 ? { x: 0, y: 0, z: 1 } : { x: 0, y: 1, z: 0 };

  const uCrossX = f.y * upRef.z - f.z * upRef.y;
  const uCrossY = f.z * upRef.x - f.x * upRef.z;
  const uCrossZ = f.x * upRef.y - f.y * upRef.x;
  const uCrossMag = Math.hypot(uCrossX, uCrossY, uCrossZ);

  if (uCrossMag === 0) {
    throw new RangeError('Invalid direction causing degenerate view basis');
  }

  const u = {
    x: uCrossX / uCrossMag,
    y: uCrossY / uCrossMag,
    z: uCrossZ / uCrossMag,
  };

  const vX = u.y * f.z - u.z * f.y;
  const vY = u.z * f.x - u.x * f.z;
  const vZ = u.x * f.y - u.y * f.x;

  return { f, u, v: { x: vX, y: vY, z: vZ } };
}

function computeSphereFrustum(
  sphere: Sphere3D,
  targetOrigin: { x: number; y: number; z: number },
  lightPos: { x: number; y: number; z: number },
  basis: ViewBasis,
  margin: number
): ShadowFrustum {
  if (sphere.radius < 0) {
    throw new RangeError('Sphere radius must be non-negative');
  }

  const centerRelX = sphere.center.x - targetOrigin.x;
  const centerRelY = sphere.center.y - targetOrigin.y;
  const centerRelZ = sphere.center.z - targetOrigin.z;

  const cU =
    centerRelX * basis.u.x + centerRelY * basis.u.y + centerRelZ * basis.u.z;
  const cV =
    centerRelX * basis.v.x + centerRelY * basis.v.y + centerRelZ * basis.v.z;

  const extent = sphere.radius * margin;

  const centerLightX = sphere.center.x - lightPos.x;
  const centerLightY = sphere.center.y - lightPos.y;
  const centerLightZ = sphere.center.z - lightPos.z;
  const axialDepth =
    centerLightX * basis.f.x +
    centerLightY * basis.f.y +
    centerLightZ * basis.f.z;

  return {
    left: cU - extent,
    right: cU + extent,
    bottom: cV - extent,
    top: cV + extent,
    near: Math.max(0.1, axialDepth - extent),
    far: axialDepth + extent,
  };
}

function computeAabbFrustum(
  aabb: Aabb3D,
  targetOrigin: { x: number; y: number; z: number },
  lightPos: { x: number; y: number; z: number },
  basis: ViewBasis,
  margin: number
): ShadowFrustum {
  if (
    aabb.min.x > aabb.max.x ||
    aabb.min.y > aabb.max.y ||
    aabb.min.z > aabb.max.z
  ) {
    throw new RangeError('AABB min coordinates must be <= max coordinates');
  }

  const corners = [
    { x: aabb.min.x, y: aabb.min.y, z: aabb.min.z },
    { x: aabb.min.x, y: aabb.min.y, z: aabb.max.z },
    { x: aabb.min.x, y: aabb.max.y, z: aabb.min.z },
    { x: aabb.min.x, y: aabb.max.y, z: aabb.max.z },
    { x: aabb.max.x, y: aabb.min.y, z: aabb.min.z },
    { x: aabb.max.x, y: aabb.min.y, z: aabb.max.z },
    { x: aabb.max.x, y: aabb.max.y, z: aabb.min.z },
    { x: aabb.max.x, y: aabb.max.y, z: aabb.max.z },
  ];

  let uMin = Infinity;
  let uMax = -Infinity;
  let vMin = Infinity;
  let vMax = -Infinity;
  let zMin = Infinity;
  let zMax = -Infinity;

  for (const corner of corners) {
    const relX = corner.x - targetOrigin.x;
    const relY = corner.y - targetOrigin.y;
    const relZ = corner.z - targetOrigin.z;

    const uVal = relX * basis.u.x + relY * basis.u.y + relZ * basis.u.z;
    const vVal = relX * basis.v.x + relY * basis.v.y + relZ * basis.v.z;

    const lightRelX = corner.x - lightPos.x;
    const lightRelY = corner.y - lightPos.y;
    const lightRelZ = corner.z - lightPos.z;
    const zVal =
      lightRelX * basis.f.x + lightRelY * basis.f.y + lightRelZ * basis.f.z;

    uMin = Math.min(uMin, uVal);
    uMax = Math.max(uMax, uVal);
    vMin = Math.min(vMin, vVal);
    vMax = Math.max(vMax, vVal);
    zMin = Math.min(zMin, zVal);
    zMax = Math.max(zMax, zVal);
  }

  const uMid = (uMin + uMax) / 2;
  const vMid = (vMin + vMax) / 2;
  const uHalfExtent = ((uMax - uMin) / 2) * margin;
  const vHalfExtent = ((vMax - vMin) / 2) * margin;

  return {
    left: uMid - uHalfExtent,
    right: uMid + uHalfExtent,
    bottom: vMid - vHalfExtent,
    top: vMid + vHalfExtent,
    near: Math.max(0.1, zMin - 0.5 * margin),
    far: zMax + 0.5 * margin,
  };
}

/**
 * Pure calculation: compute tight orthographic frustum extents for a directional light
 * enclosing the specified content volume.
 *
 * @param contentBounds - Bounding box or bounding sphere of visible content.
 * @param directionNue - Normalized sun direction.
 * @param options - Frustum options (distance, targetOrigin, margin) or scalar margin factor.
 */
export function computeShadowFrustum(
  contentBounds: ContentBounds,
  directionNue: NueDirection,
  options?: number | ShadowFrustumOptions
): ShadowFrustum {
  const { distance, targetOrigin, margin } = parseFrustumOptions(options);

  validateDirection(directionNue);
  validateMargin(margin);
  validateDistance(distance);

  const basis = computeViewBasis(directionNue);

  const lightPos = {
    x: targetOrigin.x + distance * directionNue.x,
    y: targetOrigin.y + distance * directionNue.y,
    z: targetOrigin.z + distance * directionNue.z,
  };

  if ('radius' in contentBounds) {
    return computeSphereFrustum(
      contentBounds,
      targetOrigin,
      lightPos,
      basis,
      margin
    );
  } else {
    return computeAabbFrustum(
      contentBounds,
      targetOrigin,
      lightPos,
      basis,
      margin
    );
  }
}

function resolveRigOptions(options?: SunShadowRigOptions): {
  targetOrigin: { x: number; y: number; z: number };
  distance: number;
  mapSize: number;
  bias: number;
  normalBias: number;
  groundPlaneSize: number;
  shadowOpacity: number;
  shadowColor: THREE.ColorRepresentation;
  margin: number;
  defaultContentExtent: number;
} {
  const defaults = DEFAULT_SUN_SHADOW_RIG;
  return { ...defaults, ...options };
}

function createDirectionalLight(
  options: ReturnType<typeof resolveRigOptions>
): THREE.DirectionalLight {
  const light = new THREE.DirectionalLight();
  light.castShadow = true;
  light.shadow.mapSize.width = options.mapSize;
  light.shadow.mapSize.height = options.mapSize;
  light.shadow.bias = options.bias;
  light.shadow.normalBias = options.normalBias;
  light.shadow.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
  return light;
}

function createShadowCatcher(
  options: ReturnType<typeof resolveRigOptions>
): THREE.Mesh<THREE.PlaneGeometry, THREE.ShadowMaterial> {
  const geometry = new THREE.PlaneGeometry(
    options.groundPlaneSize,
    options.groundPlaneSize
  );
  const material = new THREE.ShadowMaterial({
    opacity: options.shadowOpacity,
    color: options.shadowColor,
    transparent: true,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(
    options.targetOrigin.x,
    options.targetOrigin.y,
    options.targetOrigin.z
  );
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  return mesh;
}

function getDefaultBounds(extent: number): Aabb3D {
  return {
    min: { x: -extent, y: -extent, z: -extent },
    max: { x: extent, y: extent, z: extent },
  };
}

/**
 * Factory creating the complete Sun-driven shadow rig attached to a scene.
 *
 * @param parent - Scene or root Object3D (typically the GPS-world scene root).
 * @param options - Rig configuration parameters.
 */
export function createSunShadowRig(
  parent: THREE.Object3D,
  options?: SunShadowRigOptions
): SunShadowRig {
  const resolvedOptions = resolveRigOptions(options);

  const directionalLight = createDirectionalLight(resolvedOptions);

  const target = new THREE.Object3D();
  target.position.set(
    resolvedOptions.targetOrigin.x,
    resolvedOptions.targetOrigin.y,
    resolvedOptions.targetOrigin.z
  );
  directionalLight.target = target;

  const shadowCatcher = createShadowCatcher(resolvedOptions);

  parent.add(directionalLight);
  parent.add(target);
  parent.add(shadowCatcher);

  const rig: SunShadowRig = {
    directionalLight,
    shadowCatcher,
    target,

    update(
      directionNue: NueDirection,
      contentBounds?: ContentBounds,
      lighting?: SunLightingResult
    ): void {
      const placement = computeLightPlacement(
        resolvedOptions.targetOrigin,
        directionNue,
        resolvedOptions.distance
      );
      directionalLight.position.set(
        placement.position.x,
        placement.position.y,
        placement.position.z
      );
      target.position.set(
        placement.target.x,
        placement.target.y,
        placement.target.z
      );

      if (directionNue.y <= 0) {
        directionalLight.castShadow = false;
        directionalLight.intensity = 0;
        shadowCatcher.visible = false;
        return;
      }

      directionalLight.castShadow = true;
      shadowCatcher.visible = true;

      const bounds =
        contentBounds ?? getDefaultBounds(resolvedOptions.defaultContentExtent);
      const frustum = computeShadowFrustum(bounds, directionNue, {
        distance: resolvedOptions.distance,
        targetOrigin: resolvedOptions.targetOrigin,
        margin: resolvedOptions.margin,
      });

      const camera = directionalLight.shadow.camera;
      camera.left = frustum.left;
      camera.right = frustum.right;
      camera.top = frustum.top;
      camera.bottom = frustum.bottom;
      camera.near = frustum.near;
      camera.far = frustum.far;
      camera.updateProjectionMatrix();

      // Force camera properties to be recognized
      camera.updateMatrix();
      camera.updateMatrixWorld(true);

      if (lighting) {
        directionalLight.intensity = lighting.intensity;
        directionalLight.color.set(lighting.color);
      } else {
        directionalLight.intensity = 1;
        directionalLight.color.set(0xffffff);
      }
    },

    setVisible(visible: boolean): void {
      directionalLight.visible = visible;
      shadowCatcher.visible = visible;
      target.visible = visible;
    },

    dispose(): void {
      parent.remove(directionalLight);
      parent.remove(target);
      parent.remove(shadowCatcher);

      directionalLight.dispose();
      shadowCatcher.geometry.dispose();
      shadowCatcher.material.dispose();
    },
  };

  return rig;
}
