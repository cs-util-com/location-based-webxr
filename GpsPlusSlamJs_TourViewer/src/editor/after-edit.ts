/**
 * What the editor page does around one typed edit of the inspector: the
 * Undo offer ended before the write, the page refreshed after it, a
 * refusal said, a change counted for the autosave. And the inspector's
 * typed commands, each a write of one `EditorSession` method through that
 * path. Page-free: the page hands in its own steps (`edit-main.ts`).
 *
 * @see after-edit.ts.md
 */

import type { EditorSession } from "./editor-session.js";
import type {
  ShellEditCommands,
  TypedEditOutcome,
} from "./editor-shell/editor-shell.js";

/** One write into the open session; a refusal carries its reason. */
export type SessionWrite = (
  session: EditorSession,
) =>
  | { readonly kind: string }
  | { readonly kind: "refused"; readonly reason: string };

/** The page's steps around a typed edit. */
export interface TypedEditSteps {
  /** The open tour's session; null: no tour is open. */
  readonly session: () => EditorSession | null;
  /** Ends a delete's Undo offer (the page's `endUndo`). */
  readonly endUndo: () => void;
  /** Redraws the page from the session (the page's `refresh`). */
  readonly refresh: () => void;
  /** Says a refusal (the page's toast). */
  readonly say: (text: string) => void;
  /** Counts a change (the page's `tourChanged`). */
  readonly changed: () => void;
}

/**
 * One typed edit: no tour open is "refused" with nothing run; else the
 * Undo offer ends, `write` runs, the page refreshes, and then either the
 * refusal is said (an outcome carrying a `reason`) or, for any kind but
 * "unchanged", the change is counted.
 */
export function writeTypedEdit(
  steps: TypedEditSteps,
  write: SessionWrite,
): TypedEditOutcome {
  const session = steps.session();
  if (session === null) return "refused";
  steps.endUndo();
  const outcome = write(session);
  steps.refresh();
  if ("reason" in outcome) {
    steps.say(outcome.reason);
    return "refused";
  }
  if (outcome.kind !== "unchanged") steps.changed();
  return "written";
}

/** The inspector's commands that are one typed write each. */
export type InspectorWriteCommands = Required<
  Pick<
    ShellEditCommands,
    | "station"
    | "text"
    | "block"
    | "view"
    | "pictureTag"
    | "pictureViewpoint"
    | "model"
    | "groundItems"
    | "storyTitle"
    | "storyAdvance"
    | "storyStep"
  >
>;

/** Each inspector command as the write of its session method, through
 *  `write` (the page's typed-edit path). */
export function inspectorWriteCommands(
  write: (edit: SessionWrite) => TypedEditOutcome,
): InspectorWriteCommands {
  return {
    station: (stationId, edit) => write((e) => e.editStation(stationId, edit)),
    text: (id, text) => write((e) => e.editText(id, text)),
    block: (id, field, value) =>
      write((e) => e.editBlockField(id, field, value)),
    view: (id, view) => write((e) => e.editBlockView(id, view)),
    pictureTag: (id, shown) => write((e) => e.editPictureTag(id, shown)),
    pictureViewpoint: (id, viewpoint) =>
      write((e) => e.editPictureViewpoint(id, viewpoint)),
    model: (id, edit) => write((e) => e.editModel(id, edit)),
    groundItems: (items) => {
      write((e) => e.groundItems(items));
    },
    storyTitle: (id, title) => write((e) => e.renameStory(id, title)),
    storyAdvance: (id, advance) => write((e) => e.setStoryAdvance(id, advance)),
    storyStep: (step) => write((e) => e.setStoryStep(step)),
  };
}
