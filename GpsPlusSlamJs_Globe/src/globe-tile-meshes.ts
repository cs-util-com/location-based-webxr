/**
 * The two tile helpers both carriers of the globe's ground share: the
 * globe's surface (`globe-surface.ts`) and the relief (`globe-terrain.ts`).
 * They live apart from the surface so a page that draws only the relief
 * does not pull the surface's module (its imagery, clouds and stars) into
 * its bundle: a bundler splits by module, never inside one.
 *
 * @see globe-tile-meshes.ts.md
 */

import * as THREE from "three";

/** Every mesh under `root`, with its material typed. */
export function tileMeshes(
  root: THREE.Object3D,
): THREE.Mesh<THREE.BufferGeometry, THREE.Material>[] {
  const out: THREE.Mesh<THREE.BufferGeometry, THREE.Material>[] = [];
  root.traverse((node) => {
    // instanceof narrows to Mesh<any, any>: name the types.
    if (node instanceof THREE.Mesh) {
      out.push(node as THREE.Mesh<THREE.BufferGeometry, THREE.Material>);
    }
  });
  return out;
}

/**
 * A clone of the patched `template` that keeps its compile hooks and
 * program key: Material.copy does not carry them, and the patch would be
 * lost without an error. Neither hook uses `this` (applyGlobeSurface
 * assigns arrow functions; three's defaults ignore it).
 */
export function litCopy(
  template: THREE.MeshStandardMaterial,
): THREE.MeshStandardMaterial {
  const lit = template.clone();
  // eslint-disable-next-line @typescript-eslint/unbound-method
  lit.onBeforeCompile = template.onBeforeCompile;
  // eslint-disable-next-line @typescript-eslint/unbound-method
  lit.customProgramCacheKey = template.customProgramCacheKey;
  return lit;
}
