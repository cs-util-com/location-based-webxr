/**
 * Selecting a placed object in AR (authoring plan 2026-09-28-0953 §3.4,
 * owner decision D7): a ray from the camera through the screen centre -
 * where the reticle ring sits - cast against the objects' own geometry.
 *
 * NOT the reticle's hit point: that lies on a surface, while a pin's label
 * floats above it, so "the object nearest the hit point" picks wrongly
 * whenever two objects stand close (cold review #11). The ray hits the
 * label sprite or the photo plane itself, nearest first.
 *
 * The raycast is the framework's `raycastPointer` (DEC-H3); this module
 * only maps the hit back to the object it belongs to.
 *
 * @see object-pick.ts.md
 */

import { raycastPointer } from "gps-plus-slam-app-framework/visualization/pointer-picking";
import type { Camera, Object3D } from "three";

/** The screen centre in normalized device coordinates. */
const SCREEN_CENTRE = { x: 0, y: 0 };

/**
 * The id of the nearest object under the screen centre, or null on a miss.
 *
 * @param targets each object's root (its preview group), by object id; a
 *   hit on any descendant names the root's id.
 */
export function pickObject(
  camera: Camera,
  targets: ReadonlyMap<string, Object3D>,
): string | null {
  if (targets.size === 0) return null;
  const idByRoot = new Map<Object3D, string>();
  for (const [id, root] of targets) idByRoot.set(root, id);
  const hit = raycastPointer(camera, SCREEN_CENTRE, [...targets.values()]);
  for (let node: Object3D | null = hit?.object ?? null; node !== null;) {
    const id = idByRoot.get(node);
    if (id !== undefined) return id;
    node = node.parent;
  }
  return null;
}
