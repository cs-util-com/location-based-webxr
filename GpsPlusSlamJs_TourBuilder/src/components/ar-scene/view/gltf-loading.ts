/**
 * GLTF parsing and cloning — the two THREE-specific halves of tier-2 memory
 * (plan A9/A10).
 *
 * A *template* is the parsed asset: it owns the geometry, materials and
 * textures, i.e. the VRAM. An *instance* is a clone that shares them, so putting
 * the same knight at two waypoints costs one parse and one copy of the GPU data.
 *
 * Two rules this file exists to enforce:
 *
 * - **Clone with `SkeletonUtils.clone`, always.** A plain `Object3D.clone()`
 *   shares geometry and material (good) but does not rebind a skeleton, so a
 *   skinned/animated model — which a knight plausibly is — renders collapsed or
 *   frozen. `SkeletonUtils.clone` handles both cases, so there is no reason to
 *   branch on it.
 * - **Disposing an instance must never touch shared resources.** Only
 *   `disposeTemplate` walks the graph calling `geometry/material/texture
 *   .dispose()`; `releaseInstance` merely detaches. Deep-disposing a clone would
 *   free the template that other clones are still rendering from — a black or
 *   crashing scene that is very hard to trace back here.
 *
 * @see plans/2026-07-31-ar-scene-plan.md §5.2
 */

import type { Object3D, Sprite, Material } from "three";
import {
  Box3,
  Mesh,
  Texture,
  TextureLoader,
  PlaneGeometry,
  MeshBasicMaterial,
  DoubleSide,
  Vector3,
} from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { VISUAL_GROUND_CLEARANCE_M } from "../config.js";

/** The parsed, GPU-resident asset shared by every clone of it. */
export interface ParsedTemplate {
  readonly root: Object3D;
  /** Textures loaded by us (sprites); GLTF textures hang off the graph instead. */
  readonly ownedTextures: readonly Texture[];
}

const gltfLoader = new GLTFLoader();
const textureLoader = new TextureLoader();

/** Default sprite size in metres — a knight-sized banner at eye height. */
const SPRITE_WIDTH_M = 1.08;
const SPRITE_HEIGHT_M = 1.8;

/**
 * Parse a model or sprite from a Blob URL into a shareable template.
 * `GLTFLoader.loadAsync` on a Blob URL is the "parse blob" path from §2.5.3 —
 * it is the expensive, main-thread-blocking step the PREFETCH zone hides.
 */
export async function parseTemplate(
  kind: "model" | "sprite",
  url: string,
): Promise<ParsedTemplate> {
  if (kind === "model") {
    const gltf = await gltfLoader.loadAsync(url);
    normalizeModel(gltf.scene);
    return { root: gltf.scene, ownedTextures: [] };
  }

  const texture = await textureLoader.loadAsync(url);
  // A textured plane, not a THREE.Sprite: a Sprite always fully faces the camera
  // and cannot keep a fixed up-axis, which is the cylindrical-billboard rule
  // component 1 established (TASK §2.3.1).
  const mesh = new Mesh(
    new PlaneGeometry(SPRITE_WIDTH_M, SPRITE_HEIGHT_M),
    new MeshBasicMaterial({
      map: texture,
      transparent: true,
      side: DoubleSide,
    }),
  );
  // Float above the ground by the transport-panel clearance, not stand flush
  // on it, so the always-visible play/pause panel has room underneath.
  mesh.position.y = VISUAL_GROUND_CLEARANCE_M + SPRITE_HEIGHT_M / 2;
  return { root: mesh, ownedTextures: [texture] };
}

/**
 * Make a parsed model share the sprite template's footprint (D4,
 * Shared-Contract.md — `model`/`sprite` are interchangeable slots on a
 * waypoint) instead of rendering at whatever scale/pivot/position its author
 * left it at:
 *
 * - uniformly scaled so its height matches `SPRITE_HEIGHT_M`, preserving the
 *   model's own proportions rather than stretching it to the sprite's width;
 * - re-centred on the waypoint's vertical (X/Z) axis, matching the sprite
 *   plane, which is always centred there;
 * - lifted so its lowest point clears the ground by
 *   `VISUAL_GROUND_CLEARANCE_M`, matching the sprite/fallback-marker
 *   convention (config.ts) instead of trusting the model's authored pivot —
 *   left alone, a center-pivot GLB renders sunk roughly halfway into the
 *   ground.
 */
export function normalizeModel(root: Object3D): void {
  const box = new Box3().setFromObject(root);
  if (box.isEmpty()) return;
  const size = box.getSize(new Vector3());
  if (size.y > 0) root.scale.multiplyScalar(SPRITE_HEIGHT_M / size.y);

  const scaledBox = new Box3().setFromObject(root);
  const center = scaledBox.getCenter(new Vector3());
  root.position.x -= center.x;
  root.position.z -= center.z;
  root.position.y += VISUAL_GROUND_CLEARANCE_M - scaledBox.min.y;
}

/**
 * An instance of a template, sharing its geometry/material. Never deep-dispose
 * the result (plan A10) — `releaseInstance` is the only correct teardown.
 */
export function instantiateTemplate(template: ParsedTemplate): Object3D {
  const instance = cloneSkinned(template.root);
  instance.visible = false; // parsed and instantiated INVISIBLY (§2.5.3)
  return instance;
}

/** Detach a clone. Shared geometry/materials are deliberately left alone. */
export function releaseInstance(instance: Object3D): void {
  instance.removeFromParent();
}

/** Free a template's GPU resources. Called on LRU eviction only. */
export function disposeTemplate(template: ParsedTemplate): void {
  template.root.traverse((node: Object3D) => {
    const mesh = node as Partial<Mesh> & Partial<Sprite>;
    mesh.geometry?.dispose();
    const material = mesh.material;
    if (Array.isArray(material)) {
      for (const entry of material) disposeMaterial(entry);
    } else if (material !== undefined) {
      disposeMaterial(material);
    }
  });
  for (const texture of template.ownedTextures) texture.dispose();
  template.root.removeFromParent();
}

/** Dispose a material and any texture it holds (GLTF textures live here). */
function disposeMaterial(material: Material): void {
  for (const value of Object.values(material)) {
    if (value instanceof Texture) value.dispose();
  }
  material.dispose();
}
