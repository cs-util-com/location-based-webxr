/**
 * The `userData.arScene` stamp/walk pair shared by every module that makes a
 * mesh pickable (visuals, transcript, transport panel) and by tap-picking's
 * own raycast-hit classifier. Split out because both sides need the exact
 * same shape agreement, not because either half is large on its own.
 */

import type { Intersection, Object3D } from "three";

import type { TapHit } from "../runtime/scene-adapter.js";

interface ArSceneUserData {
  readonly arScene: {
    readonly waypointId: string;
    readonly role: TapHit["role"];
  };
}

/** Stamped on pickable meshes so a raycast hit can be classified. */
export function stamp(
  object: Object3D,
  waypointId: string,
  role: TapHit["role"],
): void {
  (object.userData as Record<string, unknown>).arScene = {
    waypointId,
    role,
  };
}

/** Walk up from the hit mesh to the nearest stamped ancestor. */
export function classify(hit: Intersection<Object3D>): TapHit | null {
  let node: Object3D | null = hit.object;
  while (node !== null) {
    const stamped = (node.userData as Partial<ArSceneUserData>).arScene;
    if (stamped !== undefined) {
      return {
        ...stamped,
        ...(hit.uv !== undefined && { uv: { u: hit.uv.x, v: hit.uv.y } }),
      };
    }
    node = node.parent;
  }
  return null;
}
