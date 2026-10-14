/**
 * The desktop editor's open tour and its edits (M6 E2a): the shared rules
 * of the phone's object list (`object-edits.ts`) over the tour the page
 * opened, and a Save built by the phone's own Finish rules
 * (`finish-rebuild.ts`). Page-free: the page shows `model()`, calls the
 * edits, and downloads what `save()` returns.
 *
 * @see editor-session.ts.md
 */

import type { QrLevel } from "gps-plus-slam-app-framework/ar/qr/qr-level";
import type {
  TourCaptureSpots,
  TourManifest,
  TourObject,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import type { SignedTourManifest } from "gps-plus-slam-app-framework/ar/tour-signed-manifest";
import {
  captureSpotsForRebuild,
  finishedFileName,
  pendingAfterRebuild,
  rebuildFinishedTour,
} from "../finish-rebuild.js";
import { objectContentKey } from "../authoring-draft.js";
import {
  recordDelete,
  recordUndoDelete,
  type DraftObjectWrites,
} from "../draft-actions.js";
import {
  authoringObjects,
  deleteObject,
  moveObjectTo,
  pinTextEdit,
  undoDelete,
  upsertPlaced,
  type AuthoringObject,
} from "../object-edits.js";
import type { TourSession } from "../tour-session.js";
import { buildEditorModel, type EditorModel } from "./editor-model.js";

/** An edited or moved object (the editor places nothing new yet). */
interface EditorEntry {
  readonly object: TourObject;
}

export interface EditorSave {
  readonly blob: Blob;
  /** The opened file's name, made safe to save (the Finish's rule). */
  readonly filename: string;
  /** Entries visitors never read that the save left out. */
  readonly scanLeftOut: readonly string[];
  /** Why the recorded photos could not be placed, when they could not. */
  readonly notPlaced?: string;
  /** The manifest the zip carries (the draft's `written` versions, M6
   *  E2c). */
  readonly written: TourManifest;
}

/** Said for an id the tour no longer carries (a restore or a save took
 *  it away while its card was open, M6 E2c review #11). */
export const NOT_IN_TOUR = "That note is no longer in this tour.";

/** What a draft offers back (`editor-draft.ts`). */
export interface EditorRestore {
  readonly objects: readonly TourObject[];
  readonly deleted: readonly string[];
}

export interface EditorSession {
  /** The tour as it stands with the edits, for the rail and the map. */
  model(): EditorModel;
  /** Edits and deletions not yet in a saved file, by content: a text
   *  edited back to the tour's own is no change (E2a review #10). */
  changeCount(): number;
  /** The ids of the notes with an edit or a move not yet saved. */
  pendingIds(): string[];
  editText(
    id: string,
    text: string,
  ): { kind: "edited" | "unchanged" } | { kind: "refused"; reason: string };
  /** Move a note on the map (its height and facing kept); false for an
   *  id the tour no longer carries. */
  move(id: string, lat: number, lon: number): boolean;
  /** Delete; returns its undo, which refuses (false) once a save wrote
   *  the delete - the saved file no longer carries the object or its
   *  photo (E2a review #9) - and for an id the tour no longer carries. */
  remove(id: string): () => boolean;
  /** Put a draft's work back by the session's own rules (M6 E2c): an
   *  object the tour carries gets the draft's version, a deletion its
   *  tombstone; live work on an id wins, and an id the tour no longer
   *  carries is skipped. What was applied is written to the draft again. */
  restore(work: EditorRestore): { changed: number; deleted: number };
  /** Build the saved zip from the newest bytes; edits made while it runs
   *  wait for the next save. Saves run one after another: one called
   *  while another runs starts when it ends (E2a review #9). */
  save(options: { readonly keepScan: boolean }): Promise<EditorSave>;
}

export function createEditorSession(input: {
  readonly session: TourSession;
  readonly manifest: TourManifest;
  readonly levels: ReadonlyMap<string, QrLevel>;
  /** The file's name for the model's title (default: the session's). */
  readonly fileName?: string;
  /** Where every edit, move, delete and undo is backed up (M6 E2c); none
   *  in a test that does not need it. */
  readonly draft?: DraftObjectWrites;
}): EditorSession {
  const { session, levels } = input;
  let manifest = input.manifest;
  let placed: EditorEntry[] = [];
  let deleted: string[] = [];
  let previous: { blob: Blob; signedManifest?: SignedTourManifest } | null =
    null;
  /** The photo spots, decided once per open (a decline is not re-baked on
   *  every save, E1 review #11). */
  let spots: Promise<{ spots?: TourCaptureSpots; notPlaced?: string }> | null =
    null;
  /** The saved file's name: the opened one's, made safe (the Finish's rule). */
  const savedName = finishedFileName(session);
  /** The name the page shows when the tour has no title. */
  const shownName = input.fileName ?? savedName;

  /** Saves whose snapshot was taken: a delete's undo is refused once a
   *  save snapshotted AFTER it - that save writes the delete - and not for
   *  a save already running when it was made (E2b plan review #2, the
   *  third E2p review #6). */
  let snapshots = 0;
  /** The saves started and not yet ended, and the end of the last. */
  let inFlight = 0;
  let tail: Promise<unknown> = Promise.resolve();

  /** The entries whose content the tour does not carry yet. */
  function unsaved(): EditorEntry[] {
    const hosted = new Map(
      manifest.objects.map((o) => [o.id, objectContentKey(o)]),
    );
    return placed.filter(
      (p) => hosted.get(p.object.id) !== objectContentKey(p.object),
    );
  }

  function objects(): AuthoringObject<EditorEntry>[] {
    return authoringObjects(manifest.objects, placed, deleted);
  }

  /** Undefined for an id the tour no longer carries: a page holding an
   *  older card gets a refusal, never a throw (E2c plan review #11). */
  function find(id: string): AuthoringObject<EditorEntry> | undefined {
    return objects().find((o) => o.object.id === id);
  }

  /** The draft's copy of an edit (fire-and-forget: the draft says its own
   *  failures, once). */
  function backUp(object: TourObject): void {
    void input.draft?.saveObject(object);
  }

  return {
    model() {
      return buildEditorModel({
        manifest: { ...manifest, objects: objects().map((o) => o.object) },
        levels,
        fileName: shownName,
      });
    },
    changeCount() {
      return unsaved().length + deleted.length;
    },
    pendingIds() {
      return unsaved().map((p) => p.object.id);
    },
    editText(id, text) {
      const found = find(id);
      if (found === undefined) return { kind: "refused", reason: NOT_IN_TOUR };
      const edit = pinTextEdit(found.object, text);
      if (edit.kind === "edited") {
        placed = upsertPlaced(placed, { object: edit.after });
        backUp(edit.after);
        return { kind: "edited" };
      }
      return edit;
    },
    move(id, lat, lon) {
      const found = find(id);
      if (found === undefined) return false;
      const after = moveObjectTo(found.object, lat, lon);
      placed = upsertPlaced(placed, { object: after });
      backUp(after);
      return true;
    },
    remove(id) {
      const found = find(id);
      if (found === undefined) return () => false;
      const gone = deleteObject({ placed, deleted }, found);
      placed = gone.placed;
      deleted = gone.deleted;
      // The shared sequences (`draft-actions.ts`), as the phone runs them.
      if (input.draft !== undefined) {
        void recordDelete(input.draft, id, gone.record.hosted);
      }
      const at = snapshots;
      return () => {
        if (snapshots > at) return false;
        const back = undoDelete({ placed, deleted }, gone.record);
        placed = back.placed;
        deleted = back.deleted;
        // An edited note's record comes back too: the delete removed it.
        if (input.draft !== undefined) {
          void recordUndoDelete(input.draft, gone.record);
        }
        return true;
      };
    },
    restore(work) {
      const live = new Set([...placed.map((p) => p.object.id), ...deleted]);
      let changed = 0;
      let gone = 0;
      for (const object of work.objects) {
        if (live.has(object.id) || find(object.id) === undefined) continue;
        placed = upsertPlaced(placed, { object });
        backUp(object);
        changed += 1;
      }
      for (const id of work.deleted) {
        const found = live.has(id) ? undefined : find(id);
        if (found === undefined) continue;
        const after = deleteObject({ placed, deleted }, found);
        placed = after.placed;
        deleted = after.deleted;
        void input.draft?.saveDeletion(id);
        gone += 1;
      }
      return { changed, deleted: gone };
    },
    save(options) {
      const start = (): Promise<EditorSave> => runSave(options);
      const next = inFlight === 0 ? start() : tail.then(start, start);
      inFlight += 1;
      tail = next
        .catch(() => undefined)
        .finally(() => {
          inFlight -= 1;
        });
      return next;
    },
  };

  async function runSave(options: {
    readonly keepScan: boolean;
  }): Promise<EditorSave> {
    // Snapshots before the first await: an edit made from here on waits
    // for the next save (`pendingAfterRebuild`).
    snapshots += 1;
    const placedNow = [...placed];
    const deletedNow = [...deleted];
    const manifestNow = manifest;
    spots ??= captureSpotsForRebuild(session, manifestNow);
    const photos = await spots;
    const finished = await rebuildFinishedTour({
      tour: session,
      manifest: manifestNow,
      placed: placedNow,
      deleted: deletedNow,
      levels: [],
      keepScan: options.keepScan,
      ...(photos.spots === undefined ? {} : { captureSpots: photos.spots }),
      previous,
    });
    if (finished === null) throw new Error("the save was stopped");
    previous = {
      blob: finished.blob,
      ...(finished.signedManifest === undefined
        ? {}
        : { signedManifest: finished.signedManifest }),
    };
    manifest = finished.written;
    const pending = pendingAfterRebuild(
      { placed, deleted },
      finished.written,
      deletedNow,
    );
    placed = pending.placed;
    deleted = pending.deleted;
    return {
      blob: finished.blob,
      filename: savedName,
      scanLeftOut: finished.scanLeftOut,
      written: finished.written,
      ...(photos.notPlaced === undefined
        ? {}
        : { notPlaced: photos.notPlaced }),
    };
  }
}
