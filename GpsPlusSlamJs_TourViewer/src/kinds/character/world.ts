/**
 * A free character in the editor's world: the visitor's character look
 * (`character-look.ts`, the die-cut figure that turns toward the camera
 * by at most 60 degrees from his facing), here with his back turned to a
 * camera more than 90 degrees round, so he is never edge-on, behind the
 * one world door
 * (`world-part.ts`), in the look of his chosen view. A view this viewer
 * does not know stands in the default look (`EDITOR_CHARACTER_VIEW`, the
 * view a new character gets); the `card` view stands nothing, as the
 * visitor sees nothing of him in the world. In play the row gives no part:
 * the visitor's free host (`free-items.ts`) stands free characters.
 *
 * @see world.ts.md
 */

import type { TourCharacterBlock } from "gps-plus-slam-app-framework/ar/tour-manifest";
import { Group, Mesh } from "three";

import type { FigureSource } from "../../character-canvas.js";
import {
  createCharacterLook,
  paintPoses,
  type CharacterLook,
  type CharacterPainters,
} from "../../character-look.js";
import {
  isStageCharacterView,
  type StageCharacterView,
} from "../../character-views.js";
import type { WorldEnv, WorldPart } from "../../world-part.js";

/** The look a character of a view the looks do not know stands in, in the
 *  editor: the format's floor for a character, `speak`. */
export const EDITOR_CHARACTER_VIEW: StageCharacterView = "speak";

/** The look the editor draws `view` in: a look's view as itself, a view
 *  the looks do not know as `EDITOR_CHARACTER_VIEW`; null for `card`,
 *  which stands nothing in the world. */
export function editorCharacterView(view: string): StageCharacterView | null {
  if (view === "card") return null;
  return isStageCharacterView(view) ? view : EDITOR_CHARACTER_VIEW;
}

/** The look's meshes a press in the editor selects him by: his figure
 *  (front and back) and the pop-up stage's figure and backdrop. His
 *  bubble, name tag, shadow and ring take no ray, so his words drawn over
 *  everything never cover another item. */
export const PICKED_CHARACTER_PARTS: ReadonlySet<string> = new Set([
  "character-front",
  "character-back",
  "character-popfigure",
  "character-backdrop",
]);

/** What the part decodes and paints with (fakes in unit tests). */
export interface CharacterWorldDeps {
  /** His image file as a picture the right way up. Default:
   *  `createImageBitmap`. */
  readonly decode?: (blob: Blob) => Promise<FigureSource>;
  readonly painters?: CharacterPainters;
}

const decodeBitmap = (blob: Blob): Promise<FigureSource> =>
  createImageBitmap(blob);

/**
 * `block`'s part: in `edit`, a group the renderer places at the block's
 * pose, his look landing in it once his image is read (his facing is the
 * pose's; the look turns from it toward the frame's camera each frame);
 * null in `play` and for a view that stands nothing. Its `ready` rejects
 * when the image cannot be read or decoded, and the renderer then takes
 * the part out.
 */
export function characterWorld(
  block: TourCharacterBlock,
  env: WorldEnv,
  deps: CharacterWorldDeps = {},
): WorldPart | null {
  if (env.mode !== "edit") return null;
  const view = editorCharacterView(block.view);
  if (view === null) return null;
  const object = new Group();
  let gone = false;
  let look: CharacterLook | null = null;
  const decode = deps.decode ?? decodeBitmap;
  const ready = env
    .loadAsset(block.image)
    .then(decode)
    .then((figure) => {
      // Painted into canvases of their own: the decoded picture is let go.
      const poses = gone ? null : paintPoses(figure, false, deps.painters);
      (figure as { close?: () => void }).close?.();
      if (poses === null) return;
      const made = createCharacterLook({
        view,
        name: block.name,
        line: block.caption ?? "",
        poses,
        // Outside a story: no card holds his line.
        noCard: true,
        // Never edge-on in the editor: from behind his back turns to the
        // camera.
        backToCamera: true,
        ...(deps.painters === undefined ? {} : { painters: deps.painters }),
      });
      made.root.name = "editor-character";
      made.root.traverse((o) => {
        if (o instanceof Mesh && !PICKED_CHARACTER_PARTS.has(o.name)) {
          o.raycast = () => undefined;
        }
      });
      look = made;
      object.add(made.root);
    });
  return {
    object,
    ready,
    update(frame) {
      if (look === null || frame.camera === undefined) return;
      look.update({ nowMs: frame.seconds * 1000, camera: frame.camera });
    },
    dispose() {
      gone = true;
      const shown = look;
      look = null;
      if (shown !== null) {
        shown.root.removeFromParent();
        shown.dispose();
      }
    },
  };
}
