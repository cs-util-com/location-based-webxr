/**
 * The shadow-receiver recipe (W4 AR shadows plan 2026-09-26-0549, §6:
 * OsmDemo's `createShadowPlane` promoted to the framework per DEC-H3): a
 * `ShadowMaterial` that draws ONLY the shadow, as darkening over the camera
 * image, and never casts. One recipe for the flat fallback plane and for the
 * occlusion mesh's receiver skin.
 *
 * @see shadow-receiver.ts.md
 */

import * as THREE from 'three';

/**
 * The polygon offset (factor and units) that keeps a receiver in front of
 * the coplanar surface it lies on: the occlusion mesh's own depth, or
 * OsmDemo's ground layers (AR sun shadow plan §7 item 16).
 */
export const SHADOW_RECEIVER_DEPTH_OFFSET = -2;

export interface ShadowReceiverOptions {
  /** Display-space opacity of a full shadow, [0, 1] (the rig's `shadowOpacity`). */
  readonly opacity: number;
  /**
   * Polygon offset factor and units, ≤ 0 (default
   * {@link SHADOW_RECEIVER_DEPTH_OFFSET}). Positive would push the receiver
   * behind the surface it must draw on, so it is refused.
   */
  readonly depthOffset?: number;
}

/** @throws RangeError for an opacity outside [0, 1] or a positive offset. */
export function assertShadowReceiverOptions(o: ShadowReceiverOptions): void {
  if (!(o.opacity >= 0 && o.opacity <= 1)) {
    throw new RangeError(
      `the shadow opacity must be in [0, 1], got ${o.opacity}`
    );
  }
  const offset = o.depthOffset ?? SHADOW_RECEIVER_DEPTH_OFFSET;
  if (!(Number.isFinite(offset) && offset <= 0)) {
    throw new RangeError(
      `the shadow depth offset must be finite and not positive, got ${offset}`
    );
  }
}

/**
 * Set the options on an existing receiver material, in place: opacity is a
 * uniform and the polygon offset is GL state, so nothing recompiles.
 */
export function applyShadowReceiverOptions(
  material: THREE.ShadowMaterial,
  o: ShadowReceiverOptions
): void {
  assertShadowReceiverOptions(o);
  const offset = o.depthOffset ?? SHADOW_RECEIVER_DEPTH_OFFSET;
  material.opacity = o.opacity;
  material.polygonOffsetFactor = offset;
  material.polygonOffsetUnits = offset;
}

/** The receiver material: transparent, no depth write, no fog, offset. */
export function createShadowReceiverMaterial(
  o: ShadowReceiverOptions,
  name = 'shadow-receiver'
): THREE.ShadowMaterial {
  assertShadowReceiverOptions(o);
  const material = new THREE.ShadowMaterial({
    name,
    transparent: true,
    fog: false,
    depthWrite: false,
    polygonOffset: true,
  });
  applyShadowReceiverOptions(material, o);
  return material;
}

/**
 * The flat receiver: a horizontal square of half width `halfWidthM` with the
 * receiver material. Receives, never casts. (Moved from OsmDemo's
 * `ar-sun-shadow.ts`, unchanged in behaviour.)
 *
 * @throws RangeError for a size or opacity out of range.
 */
export function createShadowPlane(
  halfWidthM: number,
  opacity: number
): THREE.Mesh {
  if (!(Number.isFinite(halfWidthM) && halfWidthM > 0)) {
    throw new RangeError(
      `the shadow plane half width must be positive, got ${halfWidthM}`
    );
  }
  const material = createShadowReceiverMaterial({ opacity }, 'ar-shadow-plane');
  const geometry = new THREE.PlaneGeometry(2 * halfWidthM, 2 * halfWidthM);
  geometry.rotateX(-Math.PI / 2);
  const plane = new THREE.Mesh(geometry, material);
  plane.name = 'ar-shadow-plane';
  plane.receiveShadow = true;
  plane.castShadow = false;
  return plane;
}
