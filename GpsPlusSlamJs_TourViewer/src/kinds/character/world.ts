/**
 * A free character in the editor's world: the visitor's character look
 * (`character-look.ts`, the die-cut figure that faces the camera fully),
 * behind the one world door (`world-part.ts`), in the look of his chosen
 * view. His name tag shows, and his full bubble only while he is the
 * editor's selection (the look's `selection` bubble rule): a close
 * editing camera would open every bubble at once. A view this viewer
 * does not know stands in the default look (`EDITOR_CHARACTER_VIEW`, the
 * view a new character gets); the `card` view stands nothing, as the
 * visitor sees nothing of him in the world. In play the row gives no part:
 * the visitor's free host (`free-items.ts`) stands free characters.
 *
 * @see world.ts.md
 */

import type { TourCharacterBlock } from "gps-plus-slam-app-framework/ar/tour-manifest";
import { Group, Mesh, Vector3, type Camera } from "three";

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

/** What a drawn character shows now, for the page's checks: his bubble's
 *  and name tag's openness (0 to 1) and how square on his figure faces
 *  the last frame's camera (the cosine between his turn and the bearing
 *  to the camera across his ground, 1 square on). */
export interface CharacterCheck {
  readonly bubble: number;
  readonly pip: number;
  readonly squareness: number;
}

/** The `userData` key of the part's object that holds its
 *  `() => CharacterCheck | null` (null before his look is drawn). */
export const CHARACTER_CHECK_KEY = "characterCheck";

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
 * pose's, which turns only the pop-up stage; the figure faces the frame's
 * camera each frame, and the frame's `selected` opens his bubble);
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
  let camera: Camera | null = null;
  const camAt = new Vector3();
  object.userData[CHARACTER_CHECK_KEY] = (): CharacterCheck | null => {
    if (look === null || camera === null) return null;
    const s = look.state();
    camera.getWorldPosition(camAt);
    look.root.worldToLocal(camAt);
    const bearing = Math.atan2(camAt.x, camAt.z);
    const turn = look.root.children[0]?.rotation.y ?? 0;
    return {
      bubble: s.bubble,
      pip: s.pip,
      squareness: Math.cos(turn - bearing),
    };
  };
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
        // His bubble opens while he is selected, not near the camera.
        bubbleRule: "selection",
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
      camera = frame.camera;
      look.setSelected(frame.selected === block.id);
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
