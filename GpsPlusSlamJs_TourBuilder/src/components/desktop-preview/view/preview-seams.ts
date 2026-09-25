/**
 * The three seams component 8 injects (`createAnchor`, `toWorld`,
 * `getUserWorldPos`), implemented for the desktop preview.
 *
 * The live session's versions live in `src/app/viewing/ar-seams.ts` and are
 * dominated by problems that simply do not exist here: an alignment matrix
 * that arrives late and then keeps lerping, and a framework anchor that must
 * be stopped from bootstrapping its own coordinate. The preview's frame is
 * pinned from the first frame (identity alignment, tour origin as zero
 * reference), so anchoring is a direct placement and `isFullyAnchored` is
 * true immediately — which is exactly what lets a tour show its content on a
 * desktop with no GPS at all.
 */

import { Vector3, type Camera, type Object3D } from "three";

import type { TourCoord } from "../../../store/types.js";
import type { SceneAnchor } from "../../ar-scene/view/three-scene-adapter.js";
import type { PreviewFrame } from "../core/preview-frame.js";

export interface PreviewSeamsDeps {
  readonly frame: PreviewFrame;
  readonly getCamera: () => Camera | null;
}

export interface PreviewSeams {
  createAnchor(object3D: Object3D, coord: TourCoord): SceneAnchor;
  toWorld(coord: TourCoord): Vector3 | null;
  getUserWorldPos(): Vector3 | null;
}

export function createPreviewSeams(deps: PreviewSeamsDeps): PreviewSeams {
  // `getUserWorldPos` runs every frame; the trail only re-windows at 4 Hz, so
  // only the former needs a reused scratch vector (same rule as `ar-seams`).
  const userScratch = new Vector3();

  function toWorld(coord: TourCoord): Vector3 {
    const point = deps.frame.toWorld(coord);
    return new Vector3(point.x, point.y, point.z);
  }

  return {
    toWorld,
    getUserWorldPos() {
      const camera = deps.getCamera();
      if (camera === null) return null;
      return camera.getWorldPosition(userScratch);
    },
    createAnchor(object3D, coord): SceneAnchor {
      object3D.position.copy(toWorld(coord));
      return {
        isFullyAnchored: true,
        setGpsPoint(point: TourCoord): void {
          object3D.position.copy(toWorld(point));
        },
        markMovedExternally(): void {
          // Nothing to re-converge: placement is exact and instant.
        },
        dispose(): void {
          // No framework anchor and no subscription to unwind.
        },
      };
    },
  };
}
