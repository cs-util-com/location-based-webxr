/**
 * The writes a page's draft offers for its objects (M6 E2c): the shape
 * the tour document's draft-following (`tour-document-draft.ts`) issues
 * on both pages, and the phone's builder of it over `creator-draft.ts`.
 * The ORDER that keeps an undo cut short from half restoring an object is
 * `followDocument`'s; the records are `draft-persistence.ts`'s.
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
