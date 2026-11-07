/**
 * One browser's draft directories, in memory, with the OPFS store's
 * contract (`editor/editor-draft.test.ts` has the fuller one, with every
 * fault). Test-only. `failPutsOf` makes a write of a key matching it refuse
 * (`put` resolves false, as a full disk does), so a test can see what a
 * page says when a file did not land. `snapshotBlobs` hands out a Blob
 * the way the OPFS store does (`handle.getFile()`, a snapshot of the
 * entry): its reads fail once the entry is removed or written again.
 */
import type { DraftFileStore } from "gps-plus-slam-app-framework/storage";

export interface MemoryDraftStores {
  readonly open: (key: string) => Promise<DraftFileStore | undefined>;
  /** Every namespace: key -> files. */
  readonly spaces: Map<string, Map<string, Blob | string>>;
  /** A write of a key this matches refuses. */
  failPutsOf: RegExp | null;
  /** Blobs read back fail once their entry is removed or replaced. */
  snapshotBlobs: boolean;
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

export function memoryDraftStores(): MemoryDraftStores {
  const spaces = new Map<string, Map<string, Blob | string>>();
  const stores: MemoryDraftStores = {
    spaces,
    failPutsOf: null,
    snapshotBlobs: false,
    open: (key) => {
      const files = spaces.get(key) ?? new Map<string, Blob | string>();
      spaces.set(key, files);
      return Promise.resolve({
        put: (k, data) => {
          if (stores.failPutsOf?.test(k) === true)
            return Promise.resolve(false);
          files.set(k, data as Blob | string);
          return Promise.resolve(true);
        },
        remove: (k) => {
          files.delete(k);
          return Promise.resolve();
        },
        getText: async (k) => {
          const v = files.get(k);
          return v === undefined
            ? undefined
            : typeof v === "string"
              ? v
              : v.text();
        },
        getBlob: (k) => {
          const v = files.get(k);
          if (v === undefined) return Promise.resolve(undefined);
          const blob = typeof v === "string" ? new Blob([v]) : v;
          return Promise.resolve(
            stores.snapshotBlobs
              ? new SnapshotBlob(blob, () => files.get(k) === v)
              : blob,
          );
        },
        keys: () => Promise.resolve([...files.keys()]),
        clear: () => {
          files.clear();
          return Promise.resolve();
        },
      });
    },
  };
  return stores;
}

/** Locks that are always granted: one tab. */
export function freeDraftLocks(): Promise<{
  granted: true;
  release: () => void;
  released: Promise<void>;
}> {
  return Promise.resolve({
    granted: true,
    release: () => undefined,
    released: Promise.resolve(),
  });
}
