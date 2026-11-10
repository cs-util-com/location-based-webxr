/**
 * The character library's device store: the origin private file system,
 * one folder per character under `characters/`. Same origin means the tour
 * editor on this device reads the same library. The device seam of
 * `character-library.ts`, checked by the maker's end-to-end test.
 */

import type { LibraryFile, LibraryStore } from "./character-library.js";

const ROOT = "characters";

/** Thrown when this browser has no private file system for the page. */
export class LibraryUnavailable extends Error {
  constructor() {
    super(
      "This browser cannot keep characters for this page. Open it in a current Chrome or Edge.",
    );
    this.name = "LibraryUnavailable";
  }
}

const notFound = (e: unknown): boolean =>
  e instanceof DOMException &&
  (e.name === "NotFoundError" || e.name === "TypeMismatchError");

export async function opfsLibraryStore(): Promise<LibraryStore> {
  const storage = globalThis.navigator?.storage;
  if (!storage || typeof storage.getDirectory !== "function") {
    throw new LibraryUnavailable();
  }
  let dir: FileSystemDirectoryHandle;
  try {
    dir = await (
      await storage.getDirectory()
    ).getDirectoryHandle(ROOT, {
      create: true,
    });
  } catch {
    throw new LibraryUnavailable();
  }
  return {
    async ids() {
      const out: string[] = [];
      // `entries()` is in the DOM typings only as an async iterable.
      for await (const [name, handle] of (
        dir as unknown as {
          entries(): AsyncIterable<[string, FileSystemHandle]>;
        }
      ).entries()) {
        if (handle.kind === "directory") out.push(name);
      }
      return out;
    },
    async read(id: string, file: LibraryFile) {
      try {
        const d = await dir.getDirectoryHandle(id);
        return await (await d.getFileHandle(file)).getFile();
      } catch (e) {
        if (notFound(e)) return null;
        throw e;
      }
    },
    async write(id: string, file: LibraryFile, blob: Blob) {
      const d = await dir.getDirectoryHandle(id, { create: true });
      const w = await (
        await d.getFileHandle(file, { create: true })
      ).createWritable();
      try {
        await w.write(blob);
        await w.close();
      } catch (e) {
        await w.abort().catch(() => {});
        throw e;
      }
    },
    async remove(id: string) {
      try {
        await dir.removeEntry(id, { recursive: true });
      } catch (e) {
        if (!notFound(e)) throw e;
      }
    },
  };
}
