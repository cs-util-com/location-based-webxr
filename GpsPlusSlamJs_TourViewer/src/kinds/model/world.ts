/**
 * A placed model's part in the world: the adapter that puts the model's
 * world view (`model-views.ts`) behind the one world door
 * (`world-part.ts`), so the renderer draws a model as it draws any other
 * kind's part, and the editor builds the same object in `edit`.
 *
 * The part is a group the renderer places at the block's pose; the model
 * lands in it once its file is read, at the size the tour names
 * (`modelScale`), wearing its view. The notes, sections, gestures and
 * cutaway stay the view's own: this file only adapts.
 *
 * @see world.ts.md
 */

import { TOUR_MODEL_WORLD_VIEWS } from "gps-plus-slam-app-framework/ar/tour-blocks";
import { disposeObject3D } from "gps-plus-slam-app-framework/visualization/three-dispose";
import { Group, type Object3D } from "three";

import { modelScale } from "../../model-scale.js";
import {
  mountModelView,
  type ModelViewHandle,
  type TourModelBlock,
} from "../../model-views.js";
import type { WorldEnv, WorldPart } from "../../world-part.js";

const WORLD_VIEWS: ReadonlySet<string> = new Set(TOUR_MODEL_WORLD_VIEWS);

/** The block the view is mounted with: in `edit` a clip that would play
 *  by itself is held, so the editor's model stands still. */
function shownBlock(block: TourModelBlock, env: WorldEnv): TourModelBlock {
  if (env.mode !== "edit" || block.animation?.autoplay !== true) return block;
  return { ...block, animation: { ...block.animation, autoplay: false } };
}

/**
 * `block`'s part: null in a view that stands nothing in the station (the
 * card, the story's stage) or with no size to scale by. Its `ready`
 * settles once the model stands, and rejects when its file cannot be
 * read. The model carries `tourScale` and `tourSizeM` in its `userData`,
 * so a page resizing it for a preview scales from what was drawn.
 */
export function modelWorld(
  block: TourModelBlock,
  env: WorldEnv,
): WorldPart | null {
  const sizeM = block.sizeM;
  if (!WORLD_VIEWS.has(block.view) || sizeM === undefined) return null;
  const object = new Group();
  let gone = false;
  let model: Object3D | null = null;
  let view: ModelViewHandle | null = null;
  const ready = env.loadModel(block.asset).then((loaded) => {
    if (gone) {
      disposeObject3D(loaded);
      return;
    }
    const scale = modelScale(loaded, sizeM);
    loaded.scale.setScalar(scale);
    model = loaded;
    view = mountModelView(loaded, shownBlock(block, env), scale, {
      enableClipping: () => {
        env.enableClipping();
      },
    });
    // The scale the view left (a toy starts smaller): a preview of
    // another size scales from what is drawn.
    loaded.userData["tourScale"] = loaded.scale.x;
    loaded.userData["tourSizeM"] = sizeM;
    object.add(loaded);
  });
  return {
    object,
    ready,
    dispose() {
      gone = true;
      // The view first: it gives the model back its own materials, which
      // `disposeObject3D` then frees.
      try {
        view?.dispose();
      } finally {
        view = null;
        if (model !== null) {
          model.removeFromParent();
          disposeObject3D(model);
          model = null;
        }
      }
    },
  };
}
