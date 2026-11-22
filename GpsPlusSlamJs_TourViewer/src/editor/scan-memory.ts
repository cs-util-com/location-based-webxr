/**
 * The scan remembered in this browser: a scan picked through the browser's
 * file picker is remembered as its file HANDLE, keyed by the tour's id, in
 * IndexedDB - where the file is, never its bytes, and never in the tour
 * zip - so reopening that tour can offer "Show the scan again". Reading it
 * again asks the browser's read permission in that click; a file moved
 * away since, or a refusal, is said in words. Page-free but for the
 * IndexedDB adapter: the page passes `indexedDB` and the button.
 *
 * @see scan-memory.ts.md
 */

import type { WritableFileHandle } from "./save-target.js";
import { notAddedLine } from "./added-debug-data.js";
import type { AddScanOutcome } from "./editor-entry.js";
import { indexedDbKeyValueStore } from "../key-value-db.js";

/** A picked file's handle, with the permission call Chromium has. */
export type ScanHandle = WritableFileHandle;

/** What remembering needs of a key-value store: IndexedDB's object store,
 *  or a test's Map. Its calls may reject; {@link createScanMemory} turns
 *  that into "nothing remembered". */
export interface HandleStore {
  get(key: string): Promise<unknown>;
  put(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
}

/** The database and object store the handles live in. */
const SCAN_DB = "tour-editor-scans";
const SCAN_STORE = "scans";

/** The browser's IndexedDB as the scan memory's {@link HandleStore}
 *  (`key-value-db.ts`). */
export const indexedDbHandleStore = (
  factory: IDBFactory | undefined,
): HandleStore | null => indexedDbKeyValueStore(factory, SCAN_DB, SCAN_STORE);

/** The remembered scans, by tour id. Never rejects. */
export interface ScanMemory {
  /** Remembers `handle` as this tour's scan; nothing for a tour without
   *  an id. Reads nothing of the file. */
  remember(
    tourId: string | null | undefined,
    handle: ScanHandle,
  ): Promise<void>;
  /** This tour's remembered scan, or null (none, no id, a store that
   *  failed, or something stored that is no file handle). */
  recall(tourId: string | null | undefined): Promise<ScanHandle | null>;
  /** Forgets this tour's scan. */
  forget(tourId: string | null | undefined): Promise<void>;
}

/** Whether a stored value is a file handle (structural: a stored handle
 *  comes back as one, anything else is not trusted). */
function isScanHandle(value: unknown): value is ScanHandle {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v.kind === "file" &&
    typeof v.name === "string" &&
    typeof v.getFile === "function"
  );
}

/** A tour id usable as a key: a tour without one has no key of its own. */
function keyOf(tourId: string | null | undefined): string | null {
  return typeof tourId === "string" && tourId !== "" ? tourId : null;
}

/**
 * The memory over `store`; with no store (no IndexedDB) it remembers
 * nothing. A failing store is the same as an empty one: the memory is a
 * convenience, and a private window or blocked storage must not break the
 * page.
 */
export function createScanMemory(store: HandleStore | null): ScanMemory {
  return {
    async remember(tourId, handle) {
      const key = keyOf(tourId);
      if (store === null || key === null) return;
      await store.put(key, handle).catch(() => undefined);
    },
    async recall(tourId) {
      const key = keyOf(tourId);
      if (store === null || key === null) return null;
      const value: unknown = await store.get(key).catch(() => null);
      return isScanHandle(value) ? value : null;
    },
    async forget(tourId) {
      const key = keyOf(tourId);
      if (store === null || key === null) return;
      await store.delete(key).catch(() => undefined);
    },
  };
}

/** How reading a remembered scan again ended. */
export type ReopenedScan =
  | { readonly kind: "file"; readonly file: File }
  /** The creator (or the browser) refused to let the page read it. */
  | { readonly kind: "denied" }
  /** Moved, renamed or deleted since it was picked. */
  | { readonly kind: "gone" }
  | { readonly kind: "failed"; readonly reason: string };

/**
 * Reads a remembered scan again: read permission first - call it IN the
 * click, before any other await, as the browser asks only close to a
 * click - then the file. Never rejects.
 */
export async function reopenScan(handle: ScanHandle): Promise<ReopenedScan> {
  if (typeof handle.requestPermission === "function") {
    let state: PermissionState;
    try {
      state = await handle.requestPermission({ mode: "read" });
    } catch {
      return { kind: "denied" };
    }
    if (state !== "granted") return { kind: "denied" };
  }
  try {
    return { kind: "file", file: await handle.getFile() };
  } catch (err) {
    const name = err instanceof DOMException ? err.name : "";
    if (name === "NotFoundError") return { kind: "gone" };
    if (name === "NotAllowedError" || name === "SecurityError") {
      return { kind: "denied" };
    }
    return {
      kind: "failed",
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

/** The words of the offer and its button. */
export const SHOW_SCAN_AGAIN_LABELS = {
  idle: "Show the scan again",
  busy: "Opening the scan…",
} as const;

/** The offer's line, after a tour with a remembered scan opened. */
export function scanRememberedLine(name: string): string {
  return `The scan ${name} was shown beside this tour before. It is not part of the tour.`;
}

/** What "Show the scan again" drives. */
export interface ShowScanAgainDeps {
  /** Reads the remembered scan again ({@link reopenScan}). */
  readonly reopen: () => Promise<ReopenedScan>;
  /** Adds it as the tour's scan; null when the tour changed meanwhile. */
  readonly add: (file: File) => Promise<AddScanOutcome | null>;
  /** Forgets the remembered scan (it is gone). */
  readonly forget: () => void;
}

/** How "Show the scan again" ended: done (shown, or the tour changed),
 *  or failed with its line, the offer kept where trying again can help. */
export type ShowScanAgainResult =
  | { readonly kind: "done" }
  | {
      readonly kind: "failed";
      readonly line: string;
      readonly keepOffer: boolean;
    };

/** The part of the button the run drives (structural, for tests). */
export interface ShowScanAgainButton {
  disabled: boolean;
  textContent: string | null;
}

async function showScanAgain(
  name: string,
  deps: ShowScanAgainDeps,
): Promise<ShowScanAgainResult> {
  const reopened = await deps.reopen();
  switch (reopened.kind) {
    case "gone":
      deps.forget();
      return {
        kind: "failed",
        line: `The scan ${name} is no longer where it was (moved, renamed or deleted), so it was not shown again. Add it again with "Add debug data…".`,
        keepOffer: false,
      };
    case "denied":
      return {
        kind: "failed",
        line: `The browser did not allow reading ${name} again, so it was not shown. Choose "${SHOW_SCAN_AGAIN_LABELS.idle}" to be asked once more.`,
        keepOffer: true,
      };
    case "failed":
      return {
        kind: "failed",
        line: `The scan ${name} could not be read again: ${reopened.reason}`,
        keepOffer: true,
      };
    case "file": {
      const added = await deps.add(reopened.file);
      return added?.kind === "refused"
        ? { kind: "failed", line: notAddedLine(added.reason), keepOffer: true }
        : { kind: "done" };
    }
  }
}

/**
 * "Show the scan again", clicked: the button is off and says it is
 * opening while the scan is read and added, and back in its words on
 * every end; the result says what to tell the creator. Never rejects (a
 * throw is a failed read, in words).
 */
export async function runShowScanAgain(
  button: ShowScanAgainButton,
  name: string,
  deps: ShowScanAgainDeps,
): Promise<ShowScanAgainResult> {
  button.disabled = true;
  button.textContent = SHOW_SCAN_AGAIN_LABELS.busy;
  try {
    return await showScanAgain(name, deps);
  } catch (err) {
    return {
      kind: "failed",
      line: `The scan ${name} could not be read again: ${
        err instanceof Error ? err.message : String(err)
      }`,
      keepOffer: true,
    };
  } finally {
    button.disabled = false;
    button.textContent = SHOW_SCAN_AGAIN_LABELS.idle;
  }
}
