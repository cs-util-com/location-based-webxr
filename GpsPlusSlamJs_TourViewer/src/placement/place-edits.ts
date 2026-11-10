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
 *   `setExtent`.
 *
 * A refusal comes back with its words for the page to say.
 *
 * @see place-edits.ts.md
 */
import type { QrGeoPose } from "gps-plus-slam-app-framework/ar/qr/qr-gps-vote";

import type { EditorSession } from "../editor/editor-session.js";
import type { PlaceRef } from "./placeables.js";

/** The one edit of a placeable: its whole pose, or its dots' value. */
export type PlaceEdit =
  | { readonly kind: "pose"; readonly ref: PlaceRef; readonly geo: QrGeoPose }
  | {
      readonly kind: "extent";
      readonly ref: PlaceRef;
      readonly value: number;
    };

/** The session calls a placement edit uses. */
type PlaceEditSession = Pick<
  EditorSession,
  "pose" | "moveStation" | "editStation" | "setExtent"
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
    edit.kind === "pose"
      ? ref.kind === "station"
        ? editor.moveStation(ref.id, edit.geo)
        : editor.pose(
            ref.id,
            edit.geo,
            joinStation === undefined ? {} : { joinStation },
          )
      : ref.kind === "station"
        ? editor.editStation(ref.id, { foundRadiusM: edit.value })
        : editor.setExtent(ref.id, edit.value);
  return outcome.kind === "refused"
    ? { kind: "refused", reason: outcome.reason }
    : { kind: "applied" };
}
