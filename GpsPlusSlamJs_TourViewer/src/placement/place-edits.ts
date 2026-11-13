/**
 * A placement edit - what a gesture of the 3D view, a key hold or a typed
 * place writes - and its one write through the editor session: one call,
 * so one undo step. An edit names its placeable by its HOLDER (`PlaceRef`:
 * a block or a station), never by the block's kind; the session call is
 * chosen by that holder alone:
 *
 * - a block's pose through `pose` (it keeps its station unless
 *   `joinStation` answers otherwise);
 * - a station's pose through `moveStation` (its blocks follow rigidly);
 * - a station's dots (its found radius) through `editStation`;
 * - a block's dots (a model's size, a picture's width) through
 *   `setExtent`;
 * - a plain folder's pose through `moveFolder`, its dots (its scale)
 *   through `scaleFolder` (its items follow it either way);
 * - a block's bend (a ground arrow's knob) through `editBlockField`
 *   (its `bendDeg`, checked there like a typed one).
 *
 * A refusal comes back with its words for the page to say.
 *
 * @see place-edits.ts.md
 */
import type { QrGeoPose } from "gps-plus-slam-app-framework/ar/qr/qr-gps-vote";

import type { EditorSession } from "../editor/editor-session.js";
import type { PlaceRef } from "./placeables.js";

/** The one edit of a placeable: its whole pose, its dots' value, or its
 *  bend. */
export type PlaceEdit =
  | { readonly kind: "pose"; readonly ref: PlaceRef; readonly geo: QrGeoPose }
  | {
      readonly kind: "extent";
      readonly ref: PlaceRef;
      readonly value: number;
    }
  | { readonly kind: "bend"; readonly ref: PlaceRef; readonly deg: number };

/** The session calls a placement edit uses. */
type PlaceEditSession = Pick<
  EditorSession,
  | "pose"
  | "moveStation"
  | "editStation"
  | "setExtent"
  | "moveFolder"
  | "scaleFolder"
  | "editBlockField"
>;

/** Applied, or refused with the reason the creator reads. */
export type PlaceEditOutcome =
  | { readonly kind: "applied" }
  | { readonly kind: "refused"; readonly reason: string };

/** Write `edit` through `editor`: one session call. `joinStation` is the
 *  station a moved block joins (a block's pose only). */
export function applyPlaceEdit(
  editor: PlaceEditSession,
  edit: PlaceEdit,
  joinStation?: string,
): PlaceEditOutcome {
  const { ref } = edit;
  const outcome =
    edit.kind === "bend"
      ? editor.editBlockField(ref.id, "bendDeg", String(edit.deg))
      : edit.kind === "pose"
        ? ref.kind === "station"
          ? editor.moveStation(ref.id, edit.geo)
          : ref.kind === "folder"
            ? editor.moveFolder(ref.id, edit.geo)
            : editor.pose(
                ref.id,
                edit.geo,
                joinStation === undefined ? {} : { joinStation },
              )
        : ref.kind === "station"
          ? editor.editStation(ref.id, { foundRadiusM: edit.value })
          : ref.kind === "folder"
            ? editor.scaleFolder(ref.id, edit.value)
            : editor.setExtent(ref.id, edit.value);
  return outcome.kind === "refused"
    ? { kind: "refused", reason: outcome.reason }
    : { kind: "applied" };
}
