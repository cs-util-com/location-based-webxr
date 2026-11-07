/**
 * One browser's draft directories, in memory, with the OPFS store's
 * contract (`editor/editor-draft.test.ts` has the fuller one, with every
 * fault). Test-only. `failPutsOf` makes a write of a key matching it refuse
 * (`put` resolves false, as a full disk does), so a test can see what a
 * page says when a file did not land.
 */
import type { DraftFileStore } from "gps-plus-slam-app-framework/storage";

export interface MemoryDraftStores {
  readonly open: (key: string) => Promise<DraftFileStore | undefined>;
  /** Every namespace: key -> files. */
  readonly spaces: Map<string, Map<string, Blob | string>>;
  /** A write of a key this matches refuses. */
  failPutsOf: RegExp | null;
}

export function memoryDraftStores(): MemoryDraftStores {
  const spaces = new Map<string, Map<string, Blob | string>>();
  const stores: MemoryDraftStores = {
    spaces,
    failPutsOf: null,
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
          return Promise.resolve(
            v === undefined
              ? undefined
              : typeof v === "string"
                ? new Blob([v])
                : v,
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
