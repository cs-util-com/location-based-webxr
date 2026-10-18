/**
 * What a page's draft writes when the tour document changes (D30): the
 * writes follow the STATE, not the gesture - each id whose standing
 * against the written file changed is written as the edits' own writes
 * would (`draft-actions.ts`'s order: a record before its tombstone goes),
 * and the settings record when it changed. One rule for an edit, a delete,
 * an undo, a redo and a restore alike, run by a listener after the
 * reducer (never from `store.subscribe`). Pure but for the draft's writes.
 *
 * @see tour-document-draft.ts.md
 */

import { objectContentKey } from "./authoring-draft.js";
import type { DraftObjectWrites } from "./draft-actions.js";
import type { EditEntry } from "./object-edits.js";
import type { TourDetailFields } from "./tour-details-form.js";
import type { TourDocumentState } from "./tour-document.js";

/** The tour-level settings a draft keeps: the setting, and the details
 *  once they were set or restored (`editor/editor-draft.ts` THE
 *  SETTINGS). */
export interface TourSettingsRecord {
  readonly needsNoGps: boolean;
  readonly details?: TourDetailFields;
}

/** Where a page backs its edits up: the objects' writes the pages share
 *  and the settings record. */
export interface TourDocumentDraft extends DraftObjectWrites {
  saveSettings(settings: TourSettingsRecord): Promise<boolean>;
}

/** The settings record as the document holds it now. */
export function settingsRecord(state: TourDocumentState): TourSettingsRecord {
  return state.detailsRecorded
    ? { needsNoGps: state.needsNoGps, details: state.details }
    : { needsNoGps: state.needsNoGps };
}

/** Where an id stands against the written file. */
type Standing = EditEntry | "deleted" | null;

function standing(state: TourDocumentState, id: string): Standing {
  if (state.deleted.includes(id)) return "deleted";
  return state.placed.find((p) => p.object.id === id) ?? null;
}

/** One id's draft writes for a change from `was` to `now`. */
function followId(
  draft: TourDocumentDraft,
  id: string,
  was: Standing,
  now: Standing,
  pictureOf: (id: string) => Blob | undefined,
): void {
  if (now === "deleted") {
    if (was !== "deleted") void draft.saveDeletion(id);
    return;
  }
  if (now === null) {
    if (was === "deleted") void draft.forgetDeletion(id);
    else if (was !== null) void draft.forgetObject(id);
    return;
  }
  const same =
    was !== null &&
    was !== "deleted" &&
    objectContentKey(was.object) === objectContentKey(now.object);
  if (!same) void draft.saveObject(now.object, pictureOf(id));
  if (was === "deleted") void draft.forgetDeletion(id);
}

/**
 * The draft follows the document from `before` to `after`: every write is
 * issued now, in order (each resolves on its own; the draft says its own
 * failures). Nothing is written across an open (`generation`): the new
 * tour's draft is not the old one's.
 */
export function followDocument(
  draft: TourDocumentDraft,
  before: TourDocumentState,
  after: TourDocumentState,
  pictureOf: (id: string) => Blob | undefined,
): void {
  if (before.generation !== after.generation) return;
  const ids = new Set([
    ...before.placed.map((p) => p.object.id),
    ...before.deleted,
    ...after.placed.map((p) => p.object.id),
    ...after.deleted,
  ]);
  for (const id of ids) {
    followId(draft, id, standing(before, id), standing(after, id), pictureOf);
  }
  const was = settingsRecord(before);
  const now = settingsRecord(after);
  if (JSON.stringify(was) !== JSON.stringify(now)) {
    void draft.saveSettings(now);
  }
}
