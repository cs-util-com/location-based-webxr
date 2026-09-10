/**
 * A flat, key-addressed file store in one OPFS directory.
 *
 * WHY THIS EXISTS SEPARATELY FROM `opfs-storage.ts`. That module is
 * recording-session shaped - sessions, actions, frames, a metadata schema.
 * What an authoring draft needs is a namespace and a handful of named
 * files, appended one at a time, which is a different thing wearing the
 * same API.
 *
 * WHY KEYS ARE ESCAPED RATHER THAN NESTED, and why the escaping is
 * imported rather than written again: creating nested directories from a
 * caller-supplied string is how a `..` segment becomes a traversal. That
 * reasoning, and its inverse for listing, already exist for the OSM tile
 * store; sharing them means one escaping contract rather than two that can
 * drift (see `opfs-file-names.ts`).
 *
 * EVERY METHOD DEGRADES RATHER THAN THROWING. A draft is a safety net: a
 * store that throws would turn "your work is also saved" into "your tap
 * failed", which is worse than no net at all. `put` reports whether it
 * persisted so a caller can say so once; nothing else reports anything.
 */

import { createLogger } from '../utils/logger.js';
import { fileNameFor, keyForFileName } from './opfs-file-names.js';
import {
  writeFileOrAbort,
  type WritableFileData,
} from './write-file-or-abort.js';

const log = createLogger('OpfsDraftStore');

/** The subdirectory of the app's OPFS root that drafts live in. */
export const DRAFT_STORE_DIR = 'drafts';

export interface DraftFileStore {
  /** Write one file. `false` means it did not persist - the caller's work
   *  is still in memory and must carry on regardless. */
  put(key: string, data: WritableFileData): Promise<boolean>;
  getText(key: string): Promise<string | undefined>;
  getBlob(key: string): Promise<Blob | undefined>;
  /** Every key this store holds, in no particular order. */
  keys(): Promise<readonly string[]>;
  /**
   * Delete ONE key, if it is there.
   *
   * Exists so a caller can throw away exactly what it is rejecting.
   * `clear` empties the namespace, which forces "delete everything, then
   * write back what should have stayed" - and the gap between those two
   * is a window in which the surviving work exists only in memory. A
   * targeted delete has no such window.
   *
   * Never throws and never reports: a key that was not there is already in
   * the state the caller wanted, and a caller deleting a list of ids should
   * not have to know which of them ever reached disk.
   */
  remove(key: string): Promise<void>;

  /**
   * Empty the namespace.
   *
   * **NO PRODUCTION CALLER as of 2026-09-10.** It was how a spent or
   * discarded draft was thrown away, and both callers now delete the ids
   * they are rejecting instead - because "empty everything, then write back
   * what should have stayed" left a window in which the survivors existed
   * only in memory, which is the shape that produced four silent data-loss
   * defects in the Tour Viewer's authoring. Kept because it is working,
   * tested API and its tests encode a real OPFS hazard (deleting while
   * iterating a directory skips entries), but READ THE ORDERING NOTE BELOW
   * AS HISTORY: with no caller, nothing is currently protected by it.
   *
   * `firstKey`, when given, is deleted BEFORE anything else and its
   * deletion is awaited on its own. That exists because clearing is not
   * atomic and a caller may be discarded-then-reloaded before it finishes:
   * deleting the one file that decides whether a draft EXISTS first means a
   * reload mid-clear finds no draft rather than the one just thrown away.
   * Ordering rather than synchronisation, because a page reload takes any
   * in-memory guard with it.
   */
  clear(firstKey?: string): Promise<void>;
}

/**
 * Open (creating if needed) one namespace's directory under `root`.
 *
 * The namespace is escaped into a single directory name for the same
 * reason keys are: it comes from a URL the creator pasted.
 *
 * Returns `undefined` when OPFS is unavailable or refuses - a browser
 * without it, a quota wall, a context where storage is blocked. Callers
 * treat that as "no persistence", never as an error.
 */
export async function openDraftNamespace(
  root: FileSystemDirectoryHandle,
  namespace: string
): Promise<DraftFileStore | undefined> {
  try {
    const drafts = await root.getDirectoryHandle(DRAFT_STORE_DIR, {
      create: true,
    });
    const directory = await drafts.getDirectoryHandle(
      encodeURIComponent(namespace),
      { create: true }
    );
    return createDraftFileStore(directory);
  } catch (err) {
    log.warn('draft storage unavailable:', err);
    return undefined;
  }
}

/**
 * The store over an already-resolved directory. Exported so the tests can
 * pass a fake handle and stay in node, as the OSM store's do.
 *
 * It took a `parent` and its own name until r669, so `clear` could remove
 * the whole directory in one call. That is why it no longer does: removing
 * the directory invalidates this handle, and every later write then failed
 * silently. The parameters went with the capability rather than lingering
 * as a signature nobody could safely use.
 */
export function createDraftFileStore(
  directory: FileSystemDirectoryHandle
): DraftFileStore {
  return {
    async put(key, data) {
      try {
        const handle = await directory.getFileHandle(fileNameFor(key), {
          create: true,
        });
        // NOT a hand-rolled createWritable/write/close: `close()` is what
        // COMMITS, so closing on a failure path swaps a TRUNCATED file over
        // a good one. For a draft that means a placement that reads back
        // corrupt - worse than one that was never written.
        await writeFileOrAbort(handle, data);
        return true;
      } catch (err) {
        log.warn('draft write failed:', err);
        return false;
      }
    },
    async getText(key) {
      return (await readFile(directory, key))?.text();
    },
    async getBlob(key) {
      const file = await readFile(directory, key);
      return file === undefined ? undefined : file;
    },
    async keys() {
      const out: string[] = [];
      try {
        for await (const name of directory.keys()) {
          const key = keyForFileName(name);
          if (key !== undefined) out.push(key);
        }
      } catch (err) {
        // A listing that fails means "nothing to restore", not a crash.
        log.warn('draft listing failed:', err);
      }
      return out;
    },
    async remove(key) {
      // `removeEntry` rejects with NotFoundError for a key that is not
      // there, which is not a failure for this contract.
      await directory.removeEntry(fileNameFor(key)).catch((err: unknown) => {
        if ((err as { name?: string } | undefined)?.name !== 'NotFoundError') {
          log.warn('draft remove failed:', err);
        }
      });
    },
    async clear(firstKey?: string) {
      // EMPTIED IN PLACE, never removed. Deleting the namespace directory
      // invalidates the handle this store closed over, so every later
      // `put` throws `NotFoundError`, is swallowed, and returns false - and
      // the creator is never told, because the "no persistence" notice
      // fires only at open time. A creator who tapped Discard and kept
      // walking would have had nothing saved for the rest of that tour,
      // which is precisely the loss this feature exists to prevent
      // (PR #442 review).
      //
      // The cost is an empty directory left behind, which the next
      // `openDraftNamespace` for that tour reuses. That is cheaper than a
      // contract where every caller must remember to re-open.
      try {
        // The gate file first, on its own, so a reload racing this clear
        // finds no draft rather than the one just discarded.
        if (firstKey !== undefined) {
          await directory
            .removeEntry(fileNameFor(firstKey))
            .catch(() => undefined);
        }
        // The names are COLLECTED before anything is removed. Deleting
        // while iterating `keys()` mutates the directory the iterator is
        // walking, and entries survive it - which left the meta file in
        // place, so a discarded draft was offered again on the next open.
        // The in-memory fake used by the unit tests snapshots its keys and
        // could not show this; the e2e that discards a real draft did.
        const names: string[] = [];
        for await (const name of directory.keys()) names.push(name);
        for (const name of names) {
          await directory.removeEntry(name, { recursive: true });
        }
      } catch (err) {
        // A draft that will not delete is a draft that gets offered again;
        // the offer is dismissible, so this is not worth failing over.
        log.warn('draft clear failed:', err);
      }
    },
  };
}

async function readFile(
  directory: FileSystemDirectoryHandle,
  key: string
): Promise<File | undefined> {
  try {
    const handle = await directory.getFileHandle(fileNameFor(key));
    return await handle.getFile();
  } catch {
    // NotFoundError is the common case: a draft that is not there is not an
    // error, it is the normal state for most tours.
    return undefined;
  }
}
