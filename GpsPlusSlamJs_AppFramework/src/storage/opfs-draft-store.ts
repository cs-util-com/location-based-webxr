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
  /** Drop the whole namespace. Used when a draft is spent. */
  clear(): Promise<void>;
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
    return createDraftFileStore(
      directory,
      drafts,
      encodeURIComponent(namespace)
    );
  } catch (err) {
    log.warn('draft storage unavailable:', err);
    return undefined;
  }
}

/** The store over an already-resolved directory. Exported so the tests can
 *  pass a fake handle and stay in node, as the OSM store's do. */
export function createDraftFileStore(
  directory: FileSystemDirectoryHandle,
  parent?: FileSystemDirectoryHandle,
  ownName?: string
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
    async clear() {
      try {
        if (parent !== undefined && ownName !== undefined) {
          await parent.removeEntry(ownName, { recursive: true });
          return;
        }
        for await (const name of directory.keys()) {
          await directory.removeEntry(name);
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
