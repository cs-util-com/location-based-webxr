/**
 * Writes the caster mode's shadow flags onto a scene: BOTH `castShadow` and
 * `receiveShadow` on every mesh under a root, in every mode, from the app's
 * layer table. Writing both flags everywhere is what leaves no stale flag
 * behind a mode switch; the mode itself comes from `castingMode` in
 * `two-map-shadow-rig.ts`.
 *
 * @see shadow-casting.ts.md
 */

import type * as THREE from 'three';

import {
  layerShadowFlags,
  type ShadowCastingMode,
  type ShadowLayerRows,
} from './two-map-shadow-rig.js';

/** An app's layer table plus how it finds a mesh's layer. */
export interface ShadowLayerTable extends ShadowLayerRows {
  /** The layer name of a mesh (e.g. from its `userData`), or undefined. */
  layerOf(mesh: THREE.Object3D): string | undefined;
}

const MODES: readonly ShadowCastingMode[] = ['off', 'ar', 'city'];

/**
 * Sets both shadow flags on every mesh under `root` (the root included)
 * from `table` for `mode`, and returns how many meshes it wrote.
 *
 * @throws RangeError for an unknown mode.
 */
export function applyShadowCasting(
  root: THREE.Object3D,
  mode: ShadowCastingMode,
  table: ShadowLayerTable
): number {
  if (!MODES.includes(mode)) {
    throw new RangeError(`unknown shadow casting mode: ${String(mode)}`);
  }
  let written = 0;
  root.traverse((object) => {
    if (!(object as THREE.Mesh).isMesh) return;
    const flags = layerShadowFlags(table, mode, table.layerOf(object));
    object.castShadow = flags.cast;
    object.receiveShadow = flags.receive;
    written += 1;
  });
  return written;
}
