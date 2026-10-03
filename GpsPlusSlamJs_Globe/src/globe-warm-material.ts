/**
 * Keeps a carrier's shader program warm across a release (frame-hitch
 * review 2026-10-03-2017 H4 with H2): three deletes a program when the last
 * material using it is disposed, so a carrier whose every tile was unloaded
 * compiled its program again on the way back. Retired tile materials go
 * through a retirer, which keeps the latest one undisposed.
 *
 * @see globe-warm-material.ts.md
 */
import type * as THREE from "three";

/** A retirer of tile materials: `retire` instead of `dispose`. */
export interface MaterialRetirer {
  /** Keeps `material` alive and frees the one kept before it, if any. */
  retire(material: THREE.Material): void;
  /** The material kept alive now, or null. */
  kept(): THREE.Material | null;
  /** Frees the kept material (the carrier is gone for good). */
  dispose(): void;
}

export function createMaterialRetirer(): MaterialRetirer {
  let kept: THREE.Material | null = null;
  return {
    retire(material) {
      if (material === kept) return;
      kept?.dispose();
      kept = material;
    },
    kept: () => kept,
    dispose() {
      kept?.dispose();
      kept = null;
    },
  };
}
