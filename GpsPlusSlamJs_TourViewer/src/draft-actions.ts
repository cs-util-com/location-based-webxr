/**
 * What a delete and an undo write to a page's draft (M6 E2c, the E2c plan
 * review #4): one home for the sequences the phone's object list
 * (`object-editing.ts`) and the desktop editor (`editor/editor-session.ts`)
 * both run, so the two pages cannot disagree about the order that keeps an
 * undo cut short from half restoring an object. The writes themselves are
 * the page's own draft's (`creator-draft.ts`, `editor/editor-draft.ts`);
 * the records are `draft-persistence.ts`'s.
 *
 * @see draft-actions.ts.md
 */

import type { TourObject } from "gps-plus-slam-app-framework/ar/tour-manifest";
import type { DraftFileStore } from "gps-plus-slam-app-framework/storage";
import {
  removeDraftDeletion,
  writeDraftDeletion,
} from "./draft-persistence.js";

/** The writes a page's draft offers its object actions; each resolves
 *  whether it landed (`forgetObject` reports nothing). */
export interface DraftObjectWrites {
  /** An edit, a move or a placement: the record, with its base. */
  readonly saveObject: (object: TourObject, blob?: Blob) => Promise<boolean>;
  /** A deletion's tombstone (it removes the record too). */
  readonly saveDeletion: (id: string) => Promise<boolean>;
  /** Take a deletion back (an Undo). */
  readonly forgetDeletion: (id: string) => Promise<boolean>;
  /** Drop a record only this device had. */
  readonly forgetObject: (id: string) => Promise<void>;
}

/** What an undo puts back: the object, this page's entry for it (an
 *  edited or placed object's record, with a photo's bytes), and whether
 *  the opened tour carries it (`object-edits.ts` `DeletedRecord`). */
export interface UndoneDelete {
  readonly object: { readonly id: string };
  readonly placed: { readonly object: TourObject; readonly blob?: Blob } | null;
  readonly hosted: boolean;
}

/**
 * The four writes over a draft that queues a task per object id (`write`)
 * and writes a record with its base (`writeObject`) - the phone's
 * `creator-draft.ts`.
 */
export function draftObjectWrites(draft: {
  writeObject(object: TourObject, blob?: Blob): Promise<boolean>;
  write(
    id: string,
    task: (store: DraftFileStore) => Promise<boolean>,
  ): Promise<boolean>;
  forgetObject(id: string): Promise<void>;
}): DraftObjectWrites {
  return {
    saveObject: (object, blob) => draft.writeObject(object, blob),
    saveDeletion: (id) =>
      draft.write(id, (store) => writeDraftDeletion(store, id)),
    forgetDeletion: (id) =>
      draft.write(id, (store) => removeDraftDeletion(store, id)),
    forgetObject: (id) => draft.forgetObject(id),
  };
}

/** A delete: an object the opened tour carries gets a tombstone, one only
 *  this device had loses its record. Whether it landed; never rejects. */
export function recordDelete(
  writes: DraftObjectWrites,
  id: string,
  hosted: boolean,
): Promise<boolean> {
  const write = hosted
    ? writes.saveDeletion(id)
    : writes.forgetObject(id).then(() => true);
  return write.catch(() => false);
}

/**
 * An undo of a delete: the record FIRST (an edited or placed object's -
 * the deletion removed it), then the tombstone goes. Both are issued now,
 * in that order, so the id's queue lands them in that order: until the
 * tombstone goes it outranks the record, and an undo cut short leaves the
 * object deleted rather than half restored (M4 review #5). Whether both
 * landed; never rejects.
 */
export function recordUndoDelete(
  writes: DraftObjectWrites,
  undone: UndoneDelete,
): Promise<boolean> {
  const issued: Promise<boolean>[] = [];
  if (undone.placed !== null) {
    issued.push(writes.saveObject(undone.placed.object, undone.placed.blob));
  }
  if (undone.hosted) issued.push(writes.forgetDeletion(undone.object.id));
  return Promise.all(issued.map((w) => w.catch(() => false))).then((oks) =>
    oks.every(Boolean),
  );
}
