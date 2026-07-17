/**
 * Pointer picking — an engine-free desktop raycast helper (2026-07-15
 * replay-as-dev-harness Part B).
 *
 * The shipped tap-to-place path uses the WebXR hit-test API, which does not
 * exist on desktop. This module lets a desktop-replay (or any non-WebXR)
 * consumer turn a pointer position into a world-space hit against real geometry
 * — e.g. the reconstructed occlusion mesh (`OcclusionMesh.getMesh()`) — using a
 * plain `THREE.Raycaster`. No physics engine required; a physics consumer may
 * additionally cast through its own collider for guaranteed collider-consistency
 * (that path stays in the consumer, never here).
 *
 * The genuinely error-prone, reusable part is the pointer→NDC conversion; the
 * raycast itself is a thin, allocation-conscious wrapper.
 *
 * @see pointer-picking.ts.md
 * @see occlusion-mesh.ts (getMesh — the intended target surface)
 */

import * as THREE from 'three';

/** Normalized device coordinates, each component in [-1, 1]. */
export interface Ndc {
  readonly x: number;
  readonly y: number;
}

/** The subset of `DOMRect` this module needs (so tests need not fake a full one). */
export interface ElementRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Convert a pointer's client position to normalized device coordinates in
 * [-1, 1], with +Y up (WebGL/Three convention — the inverse of screen Y).
 *
 * Degenerate (zero-size) rects map to the centre (0, 0) rather than dividing by
 * zero, so a pre-layout pointer event can never produce `NaN`.
 */
export function pointerToNdc(
  clientX: number,
  clientY: number,
  rect: ElementRect
): Ndc {
  const width = rect.width || 1;
  const height = rect.height || 1;
  return {
    x: ((clientX - rect.left) / width) * 2 - 1,
    // Written as `1 - …` (not `-( … - 1)`) so the centre yields +0, not −0.
    y: 1 - ((clientY - rect.top) / height) * 2,
  };
}

/**
 * The nearest ray/geometry intersection from `camera` through the pointer NDC,
 * or `null` when the ray misses every target. Recurses into children, so passing
 * a group (or a single mesh) both work.
 *
 * Pass a reused `raycaster` in a hot loop to avoid per-call allocation. The
 * caller is responsible for the objects' and camera's world matrices being
 * up to date (they are after a render; call `updateMatrixWorld()` otherwise).
 */
export function raycastPointer(
  camera: THREE.Camera,
  ndc: Ndc,
  objects: readonly THREE.Object3D[],
  raycaster: THREE.Raycaster = new THREE.Raycaster()
): THREE.Intersection | null {
  raycaster.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), camera);
  const hits = raycaster.intersectObjects(objects as THREE.Object3D[], true);
  return hits[0] ?? null;
}

/**
 * Convenience over {@link raycastPointer}: the world-space hit point, or `null`
 * on a miss. This is the "click a real surface → world point" primitive a
 * placement layer wants.
 */
export function pickWorldPoint(
  camera: THREE.Camera,
  ndc: Ndc,
  objects: readonly THREE.Object3D[],
  raycaster?: THREE.Raycaster
): THREE.Vector3 | null {
  return raycastPointer(camera, ndc, objects, raycaster)?.point ?? null;
}
