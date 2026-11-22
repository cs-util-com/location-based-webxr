/**
 * The one in-memory draft store of the tests: one browser's draft
 * directories, with the OPFS store's contract (strings and Blobs, a Blob
 * read back as text, a string read back as a Blob), plus the faults a test
 * needs to see what a page does when a file does not land. Test-only.
 *
 * Faults, all off by default and settable at any time:
 * - `failPutsOf` refuses a write of a key it matches, `failIn` every write
 *   to a namespace, `failMetaPuts` that many of the next meta writes: `put`
 *   resolves false, as a full disk or a revoked handle does.
 * - `holdPuts` (every write) and `holdPutsOf` (the keys it matches) hold a
 *   write, and `holdRemovesOf` a removal of the keys it matches, until
 *   `releasePuts(ok)`; `holdOpenOf` holds a namespace's open until
 *   `releaseOpens()`: the order changes land in.
 * - `failRemoveOf` makes a removal of those keys throw (a store breaking
 *   its never-throws contract: the one way a removal can be seen to fail).
 * - `unreadable` keys read back as missing; `beforePut` runs before each
 *   write lands, so a test may write meanwhile.
 * - `snapshotBlobs` hands out a Blob the way the OPFS store does
 *   (`handle.getFile()`, a snapshot of the entry): its reads fail once the
 *   entry is removed or written again.
 * - `crashAfter` closes the tab after that many more changes have landed:
 *   every later write refuses and every later removal or clear changes
 *   nothing, until it is set back to null (the next page load). What
 *   landed before stays, as a crash leaves it. While it is set, a `clear`
 *   removes one file at a time, in the order they were written, each a
 *   change of its own: a crash midway leaves the later files, as a
 *   directory emptied entry by entry does.
 *
 * `log` lists every change that landed, in order (`put <key>`,
 * `remove <key>`, `clear`), so a test can see which file a page wrote
 * first. `refused` lists every write a fault above refused (not the
 * ones a crash refused), so a test can tell a step that lost a write.
 *
 * `memoryDraftOps()` counts every open, write, removal and clear of every
 * memory store of the test file, so a `settle` can wait until they stop.
 */
import type { DraftFileStore } from "gps-plus-slam-app-framework/storage";
import { readStoredEntryBytes } from "gps-plus-slam-app-framework/test-utils/zip-central-directory";

import { META_KEY } from "../draft-persistence.js";
import type { EditorLock } from "../editor/save-target.js";

type Files = Map<string, Blob | string>;

export interface MemoryDraftStores {
  readonly open: (key: string) => Promise<DraftFileStore>;
  /** Every namespace: key -> files. */
  readonly spaces: Map<string, Files>;
  /** Every namespace opened, in order. */
  readonly opened: string[];
  /** A write of a key this matches refuses. */
  failPutsOf: RegExp | null;
  /** Every write to these namespaces refuses. */
  readonly failIn: Set<string>;
  /** That many of the next meta writes refuse. */
  failMetaPuts: number;
  /** Every write waits for `releasePuts`. */
  holdPuts: boolean;
  /** A write of a key this matches waits for `releasePuts`. */
  holdPutsOf: RegExp | null;
  /** A removal of a key this matches waits for `releasePuts`. */
  holdRemovesOf: RegExp | null;
  /** Lands (or, with `ok` false, refuses) every held write, lands every
   *  held removal, and stops holding new ones. */
  readonly releasePuts: (ok?: boolean) => void;
  /** An open of these namespaces waits for `releaseOpens`. */
  readonly holdOpenOf: Set<string>;
  readonly releaseOpens: () => void;
  /** A removal of these keys throws. */
  readonly failRemoveOf: Set<string>;
  /** These keys read back as missing. */
  readonly unreadable: Set<string>;
  /** Runs before each write lands. */
  beforePut: ((key: string) => Promise<void>) | null;
  /** Blobs read back fail once their entry is removed or replaced. */
  snapshotBlobs: boolean;
  /** The tab closes after this many more changes landed (null: never). */
  crashAfter: number | null;
  /** Every change that landed, in order: `put <key>`, `remove <key>`,
   *  `clear`. */
  readonly log: string[];
  /** Every write a fault refused (`failPutsOf`, `failIn`,
   *  `failMetaPuts`), by key, in order. */
  readonly refused: string[];
}

/** Every open, write, removal and clear so far, of every memory store. */
let opsSoFar = 0;

/** What a `settle` watches: changes while any memory store is busy. */
export function memoryDraftOps(): number {
  return opsSoFar;
}

/** A Blob whose reads fail once `alive()` is false, as a File read from
 *  an origin-private entry since removed (NotReadableError). */
class SnapshotBlob extends Blob {
  readonly #alive: () => boolean;
  constructor(source: Blob, alive: () => boolean) {
    super([source], { type: source.type });
    this.#alive = alive;
  }
  /** The read error once the entry changed, else null. */
  #gone(): DOMException | null {
    return this.#alive()
      ? null
      : new DOMException("the entry changed", "NotReadableError");
  }
  override arrayBuffer(): Promise<ArrayBuffer> {
    const gone = this.#gone();
    return gone === null ? super.arrayBuffer() : Promise.reject(gone);
  }
  override text(): Promise<string> {
    const gone = this.#gone();
    return gone === null ? super.text() : Promise.reject(gone);
  }
  override bytes(): Promise<Uint8Array<ArrayBuffer>> {
    const gone = this.#gone();
    return gone === null ? super.bytes() : Promise.reject(gone);
  }
  override stream(): ReadableStream<Uint8Array<ArrayBuffer>> {
    const gone = this.#gone();
    if (gone !== null) throw gone;
    return super.stream();
  }
  override slice(start?: number, end?: number, type?: string): Blob {
    const gone = this.#gone();
    if (gone !== null) throw gone;
    return super.slice(start, end, type);
  }
}

/** One namespace's store over `files`, with the faults of `browser`. */
function storeOver(
  files: Files,
  key: string,
  browser: MemoryDraftStores,
  held: ((ok: boolean) => void)[],
): DraftFileStore {
  const read = (k: string): Blob | string | undefined =>
    browser.unreadable.has(k) ? undefined : files.get(k);
  /** Whether a change may still land (the tab has not crashed); one that
   *  may counts toward the crash and is logged. */
  const changes = (entry: string): boolean => {
    if (browser.crashAfter !== null) {
      if (browser.crashAfter <= 0) return false;
      browser.crashAfter -= 1;
    }
    browser.log.push(entry);
    return true;
  };
  const land = (k: string, data: Blob | string): boolean => {
    if (!changes(`put ${k}`)) return false;
    files.set(k, data);
    opsSoFar += 1;
    return true;
  };
  const write = (k: string, data: Blob | string): Promise<boolean> => {
    if (browser.failPutsOf?.test(k) === true || browser.failIn.has(key)) {
      browser.refused.push(k);
      return Promise.resolve(false);
    }
    if (k === META_KEY && browser.failMetaPuts > 0) {
      browser.failMetaPuts -= 1;
      browser.refused.push(k);
      return Promise.resolve(false);
    }
    if (browser.holdPuts || browser.holdPutsOf?.test(k) === true) {
      return new Promise((resolve) => {
        held.push((ok) => {
          resolve(ok && land(k, data));
        });
      });
    }
    return Promise.resolve(land(k, data));
  };
  return {
    put: async (k, data) => {
      opsSoFar += 1;
      const before = browser.beforePut;
      if (before !== null) await before(k);
      return write(k, data as Blob | string);
    },
    remove: (k) => {
      if (browser.failRemoveOf.has(k)) {
        return Promise.reject(new Error("the removal failed"));
      }
      opsSoFar += 1;
      const lands = (): void => {
        if (changes(`remove ${k}`)) files.delete(k);
      };
      if (browser.holdRemovesOf?.test(k) === true) {
        return new Promise((resolve) => {
          held.push(() => {
            lands();
            resolve();
          });
        });
      }
      lands();
      return Promise.resolve();
    },
    getText: async (k) => {
      const v = read(k);
      return v === undefined ? undefined : typeof v === "string" ? v : v.text();
    },
    getBlob: (k) => {
      const v = read(k);
      if (v === undefined) return Promise.resolve(undefined);
      const blob = typeof v === "string" ? new Blob([v]) : v;
      return Promise.resolve(
        browser.snapshotBlobs
          ? new SnapshotBlob(blob, () => files.get(k) === v)
          : blob,
      );
    },
    keys: () => Promise.resolve([...files.keys()]),
    clear: () => {
      opsSoFar += 1;
      if (browser.crashAfter === null) {
        if (changes("clear")) files.clear();
        return Promise.resolve();
      }
      for (const k of [...files.keys()]) {
        if (changes(`remove ${k}`)) files.delete(k);
      }
      return Promise.resolve();
    },
  };
}

/** One browser's draft directories, by key. */
export function memoryDraftStores(): MemoryDraftStores {
  const spaces = new Map<string, Files>();
  const heldPuts: ((ok: boolean) => void)[] = [];
  const heldOpens: (() => void)[] = [];
  const browser: MemoryDraftStores = {
    spaces,
    opened: [],
    failPutsOf: null,
    failIn: new Set(),
    failMetaPuts: 0,
    holdPuts: false,
    holdPutsOf: null,
    holdRemovesOf: null,
    releasePuts: (ok = true) => {
      browser.holdPuts = false;
      browser.holdPutsOf = null;
      browser.holdRemovesOf = null;
      for (const land of heldPuts.splice(0)) land(ok);
    },
    holdOpenOf: new Set(),
    releaseOpens: () => {
      browser.holdOpenOf.clear();
      for (const land of heldOpens.splice(0)) land();
    },
    failRemoveOf: new Set(),
    unreadable: new Set(),
    beforePut: null,
    snapshotBlobs: false,
    crashAfter: null,
    log: [],
    refused: [],
    open: (key) => {
      opsSoFar += 1;
      browser.opened.push(key);
      const files = spaces.get(key) ?? new Map<string, Blob | string>();
      spaces.set(key, files);
      const store = storeOver(files, key, browser, heldPuts);
      if (!browser.holdOpenOf.has(key)) return Promise.resolve(store);
      return new Promise((resolve) => {
        heldOpens.push(() => {
          resolve(store);
        });
      });
    },
  };
  return browser;
}

/** One namespace on its own, its files at hand (no faults). */
export function memoryDraftStore(): DraftFileStore & { readonly files: Files } {
  const files: Files = new Map();
  return Object.assign(storeOver(files, "", memoryDraftStores(), []), {
    files,
  });
}

/** Every lock granted: one tab. */
export function freeLocks(): Promise<EditorLock> {
  return Promise.resolve({
    granted: true,
    release: () => undefined,
    released: Promise.resolve(),
  });
}

/** The `tour.json` of a written zip. */
export async function writtenJson(
  blob: Blob,
): Promise<Record<string, unknown>> {
  const bytes = readStoredEntryBytes(
    new Uint8Array(await blob.arrayBuffer()),
    "tour.json",
  );
  return JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
}
