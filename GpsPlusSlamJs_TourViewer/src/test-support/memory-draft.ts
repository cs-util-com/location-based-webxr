/**
 * One browser's draft directories in memory, with the OPFS store's contract
 * (`editor-draft.test.ts` has the fuller one, with faults), an always free
 * tab lock, and the manifest out of a written zip: what a test of a draft
 * reload needs.
 */
import type { DraftFileStore } from "gps-plus-slam-app-framework/storage";
import { readStoredEntryBytes } from "gps-plus-slam-app-framework/test-utils/zip-central-directory";

import type { EditorLock } from "../editor/save-target.js";

/** One browser's draft directories, by key. */
export function memoryDraftStores(): {
  open: (key: string) => Promise<DraftFileStore | undefined>;
} {
  const spaces = new Map<string, Map<string, Blob | string>>();
  return {
    open: (key) => {
      const files = spaces.get(key) ?? new Map<string, Blob | string>();
      spaces.set(key, files);
      return Promise.resolve({
        put: (k, data) => {
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
