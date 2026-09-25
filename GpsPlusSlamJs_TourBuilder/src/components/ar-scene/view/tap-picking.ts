/**
 * The raycast pick set and tap classification. Desktop taps and XR selects
 * both resolve to the same `Intersection` shape (`ray-sources.ts`'s job), so
 * everything from here down is identical regardless of which produced the hit.
 */

import type { Camera, Intersection, Object3D } from "three";

import type { TapHit } from "../runtime/scene-adapter.js";
import { createListenerSet } from "../core/listener-set.js";
import { classify } from "./pick-classify.js";
import {
  createPointerRaySource,
  createXrSelectRaySource,
  type RaySource,
  type TargetRayMatrixSource,
  type XrSessionLike,
} from "./ray-sources.js";
import type { WaypointNode } from "./waypoint-registry.js";

export interface TapPickingOptions {
  readonly camera: Camera;
  /** Desktop tap source. Omit when an `xrSession` is given. */
  readonly domElement?: HTMLElement;
  readonly xrSession?: XrSessionLike;
  readonly getTargetRayMatrix?: TargetRayMatrixSource;
}

export function createTapPicking(options: TapPickingOptions) {
  const tapListeners = createListenerSet<[TapHit]>();
  let pickTargets: Object3D[] = [];

  function emitTap(hit: Intersection<Object3D>): void {
    const classified = classify(hit);
    if (classified === null) return;
    tapListeners.emit(classified);
  }

  const raySource: RaySource =
    options.xrSession !== undefined && options.getTargetRayMatrix !== undefined
      ? createXrSelectRaySource({
          session: options.xrSession,
          getTargetRayMatrix: options.getTargetRayMatrix,
          getPickTargets: () => pickTargets,
          onHit: emitTap,
        })
      : createPointerRaySource({
          domElement: options.domElement!,
          camera: options.camera,
          getPickTargets: () => pickTargets,
          onHit: emitTap,
        });

  return {
    setPickTargets(nodes: readonly (WaypointNode | undefined)[]): void {
      const targets: Object3D[] = [];
      for (const node of nodes) {
        if (node === undefined) continue;
        // Only what is actually on screen: the raycaster does not skip
        // invisible objects, so a hidden mesh here would eat taps (plan A12).
        if (node.visual !== null && node.visual.visible)
          targets.push(node.visual);
        if (node.text !== null && node.text.group.visible) {
          targets.push(node.text.pickMesh);
        }
        if (node.transportPanel !== null && node.transportPanel.mesh.visible) {
          targets.push(node.transportPanel.mesh);
        }
      }
      pickTargets = targets;
    },

    onTap(listener: (hit: TapHit) => void): () => void {
      return tapListeners.add(listener);
    },

    dispose(): void {
      raySource.dispose();
      tapListeners.clear();
      pickTargets = [];
    },
  };
}
