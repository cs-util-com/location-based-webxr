/**
 * Three.js resource dispose utilities.
 *
 * Generic GPU resource cleanup for Object3D trees and mesh arrays.
 * Handles geometries, materials, and every texture a material holds in a
 * property of its own (`map`, `normalMap`, `roughnessMap`, ...). A
 * ShaderMaterial's UNIFORM textures are left alone: a uniform often holds a
 * texture another object owns (the camera blit's camera texture).
 */

import type * as THREE from 'three';

export interface DisposeOptions {
  /** When true, skip geometry.dispose() — useful for shared geometries. */
  readonly skipGeometry?: boolean;
  /** When true, skip material.dispose() (and its textures) — useful for shared materials. */
  readonly skipMaterial?: boolean;
}

/** A three.js texture (by its `isTexture` flag, as three tests it). */
function isTexture(value: unknown): value is THREE.Texture {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { isTexture?: unknown }).isTexture === true
  );
}

/**
 * Traverse an Object3D and all its descendants, disposing GPU resources:
 * geometries (Mesh), materials (Mesh + Sprite), and material textures.
 *
 * Does NOT remove root from its parent — callers handle that.
 *
 * @param root The Object3D tree root to clean up.
 * @param opts Optional flags (e.g. skipGeometry for shared geometries).
 */
export function disposeObject3D(
  root: THREE.Object3D,
  opts?: DisposeOptions
): void {
  const disposed = new Set<{ dispose(): void }>();

  root.traverse((object: THREE.Object3D) => {
    // Dispose geometry on Mesh instances
    if ('geometry' in object && (object as THREE.Mesh).geometry) {
      const geo = (object as THREE.Mesh).geometry;
      if (!opts?.skipGeometry && !disposed.has(geo)) {
        disposed.add(geo);
        geo.dispose();
      }
    }

    // Dispose material (and its textures) on Mesh and Sprite instances.
    // Mesh.material can be a single Material or an array (geometry groups).
    if (!opts?.skipMaterial && 'material' in object) {
      const raw = (object as THREE.Mesh | THREE.Sprite).material;
      const materials: THREE.Material[] = Array.isArray(raw) ? raw : [raw];

      for (const mat of materials) {
        if (!mat || disposed.has(mat)) continue;
        disposed.add(mat);
        // Every texture slot, not only `map` (tour kit K4 review R12): a
        // loaded GLB carries normal, roughness, emissive and other maps.
        for (const value of Object.values(mat)) {
          if (!isTexture(value) || disposed.has(value)) continue;
          disposed.add(value);
          value.dispose();
        }
        mat.dispose();
      }
    }
  });
}

/**
 * Remove meshes from a parent, dispose their GPU resources, and clear
 * the array in-place.
 *
 * @param meshes Array of meshes (mutated — emptied after disposal).
 * @param parent The Object3D to remove meshes from. Pass null/undefined to skip removal.
 * @param opts   Optional flags (e.g. skipGeometry for shared geometries).
 */
export function disposeMeshArray(
  meshes: THREE.Mesh[],
  parent?: THREE.Object3D | null,
  opts?: DisposeOptions
): void {
  for (const mesh of meshes) {
    if (parent) {
      parent.remove(mesh);
    }
    disposeObject3D(mesh, opts);
  }
  meshes.length = 0;
}
