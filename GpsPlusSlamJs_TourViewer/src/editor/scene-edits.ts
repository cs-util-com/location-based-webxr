/**
 * A gesture of the 3D view (`../editor3d/gesture.ts`) written through the
 * editor session: one call, so one undo step. An item's pose goes through
 * `pose` (the station rule may seat it in another station), a station's
 * anchor through `moveStation` (its items follow rigidly), a station's
 * found radius through `editStation`, a model's size through
 * `resizeModel`. A refusal comes back with its words for the page to say.
 *
 * @see scene-edits.ts.md
 */
import type { GestureEdit } from "../editor3d/gesture.js";
import type { EditorSession } from "./editor-session.js";

/** The session calls a scene edit uses. */
type SceneEditSession = Pick<
  EditorSession,
  "pose" | "moveStation" | "editStation" | "resizeModel"
>;

/** Applied, or refused with the reason the creator reads. */
export type SceneEditOutcome =
  | { readonly kind: "applied" }
  | { readonly kind: "refused"; readonly reason: string };

/** Write `edit` through `editor`: one session call. */
export function applySceneEdit(
  editor: SceneEditSession,
  edit: GestureEdit,
): SceneEditOutcome {
  const outcome =
    edit.kind === "item-pose"
      ? editor.pose(edit.id, edit.geo)
      : edit.kind === "station-pose"
        ? editor.moveStation(edit.id, edit.geo)
        : edit.kind === "radius"
          ? editor.editStation(edit.id, { foundRadiusM: edit.foundRadiusM })
          : editor.resizeModel(edit.id, edit.sizeM);
  return outcome.kind === "refused"
    ? { kind: "refused", reason: outcome.reason }
    : { kind: "applied" };
}
