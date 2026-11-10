/**
 * Test-only: a `LibraryStore` in memory, recording the order of writes so a
 * test can prove the record is written last, and able to fail a chosen
 * write to stand in for a page closed mid-save.
 */

import type { LibraryStore } from "../character-library.js";

export interface MemoryLibraryStore extends LibraryStore {
  readonly files: Map<string, Blob>;
  readonly writes: string[];
  /** The next write to this file name throws. */
  failNextWriteOf(file: string): void;
}

export function memoryLibraryStore(): MemoryLibraryStore {
  const files = new Map<string, Blob>();
  const writes: string[] = [];
  let failing: string | null = null;
  return {
    files,
    writes,
    failNextWriteOf(file) {
      failing = file;
    },
    ids() {
      return Promise.resolve([
        ...new Set([...files.keys()].map((k) => k.split("/")[0]!)),
      ]);
    },
    read(id, file) {
      return Promise.resolve(files.get(`${id}/${file}`) ?? null);
    },
    write(id, file, blob) {
      if (failing === file) {
        failing = null;
        return Promise.reject(new Error("the page closed"));
      }
      writes.push(`${id}/${file}`);
      files.set(`${id}/${file}`, blob);
      return Promise.resolve();
    },
    remove(id) {
      for (const k of [...files.keys()]) {
        if (k.startsWith(`${id}/`)) files.delete(k);
      }
      return Promise.resolve();
    },
  };
}
