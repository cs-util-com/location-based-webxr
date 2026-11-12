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
import { markPlaceScale } from "../../placement/place-scale.js";
import {
  mountModelView,
  type ModelViewHandle,
  type TourModelBlock,
} from "../../model-views.js";
import type { WorldEnv, WorldPart } from "../../world-part.js";

const WORLD_VIEWS: ReadonlySet<string> = new Set(TOUR_MODEL_WORLD_VIEWS);

/**
 * `block`'s part: null in a view that stands nothing in the station (the
 * card) or with no size to scale by. Its `ready`
 * settles once the model stands, and rejects when its file cannot be
 * read. The model carries `tourScale` in its `userData` (the editor finds
 * its models by it) and the place-scale mark of its size
 * (`placement/place-scale.ts`), so a page resizing it for a preview
 * scales from what was drawn. In
 * `edit` the model stands plain, at its tour size, with no view mounted.
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
    // The editor drives no frame of a view (a ghost's ground, a clip),
    // and switches no clipping on: it shows the plain model, still.
    if (env.mode === "play") {
      view = mountModelView(loaded, block, scale, {
        enableClipping: () => {
          env.enableClipping();
        },
      });
    }
    // The scale the view left (a toy starts smaller): a preview of
    // another size scales from what is drawn.
    loaded.userData["tourScale"] = loaded.scale.x;
    markPlaceScale(loaded, sizeM);
    object.add(loaded);
  });
  return {
    object,
    ready,
    dispose() {
      gone = true;
      // The view first: it gives the model back its own materials, which
      // `disposeObject3D` then frees. Both are let go before freeing, so a
      // free that throws leaves nothing for a second dispose to free again;
      // the first failure is the one the caller is told.
      const shown = view;
      const drawn = model;
      view = null;
      model = null;
      let failed = false;
      let first: unknown;
      const attempt = (free: () => void): void => {
        try {
          free();
        } catch (error) {
          if (!failed) first = error;
          failed = true;
        }
      };
      if (shown !== null) attempt(() => shown.dispose());
      if (drawn !== null) {
        drawn.removeFromParent();
        attempt(() => disposeObject3D(drawn));
      }
      if (failed) throw first;
    },
  };
}
