/**
 * Reading a zip held in memory (a Blob this page built): its entry names,
 * and one entry's bytes - under the same caps every archive read here uses
 * (`DEFAULT_ARCHIVE_LIMITS`, a decompression budget sized from the blob).
 * The desktop editor's last save is such a blob: a deleted photo's picture
 * is read from it when the opened file no longer reads (M4a review #5),
 * and "move the walk out" lists it (tour editor plan 2026-10-17-1816, W2).
 *
 * @see zip-blob.ts.md
 */

import type { FileEntry } from "@zip.js/zip.js";
import {
  DecompressionBudget,
  readZipEntryBlob,
} from "gps-plus-slam-app-framework/storage";
import { withCappedZipEntries } from "gps-plus-slam-app-framework/storage/zip-reader";

/** The file entries' names, in archive order (directories left out).
 *  Throws for bytes that are not a readable zip, or past the entry cap. */
export function zipBlobEntryNames(blob: Blob): Promise<string[]> {
  return withCappedZipEntries(blob, (entries) =>
    Promise.resolve(entries.filter((e) => !e.directory).map((e) => e.filename)),
  );
}

/** One read of a zip's central directory: its file entries and a way to
 *  read one of them, valid only inside the `use` callback. */
export interface ZipBlobDirectory {
  /** The file entries' names, in archive order (directories left out). A
   *  name the zip carries twice is listed twice, so a reader can refuse
   *  the ambiguity rather than read one of the two unknowingly. */
  readonly names: readonly string[];
  /** An entry's uncompressed size as the directory declares it (the
   *  first entry of a repeated name). */
  sizeOf(name: string): number | undefined;
  /** An entry's bytes (the first entry of a repeated name); rejects,
   *  naming it, when the zip lacks it. `maxEntryBytes` caps what is
   *  inflated, below the archive's budget: a directory can understate an
   *  entry's size, and the budget alone lets one inflate to tens of MiB
   *  before a caller could look at its size. */
  read(name: string, maxEntryBytes?: number): Promise<Blob>;
}

/**
 * Reads the directory once and hands it to `use`: only the directory's
 * bytes are read, plus whatever `use` reads. Throws as
 * {@link zipBlobEntryNames} does. A File works as well as a built Blob.
 */
export function withZipBlobDirectory<T>(
  blob: Blob,
  use: (directory: ZipBlobDirectory) => Promise<T>,
): Promise<T> {
  return withCappedZipEntries(blob, (entries) => {
    const names: string[] = [];
    const files = new Map<string, FileEntry>();
    for (const e of entries) {
      if (e.directory) continue;
      names.push(e.filename);
      if (!files.has(e.filename)) files.set(e.filename, e);
    }
    // One budget for every read of this directory: it bounds what the
    // archive may inflate in total, not what each read may.
    const budget = DecompressionBudget.forArchive(blob.size);
    return use({
      names,
      sizeOf: (name) => files.get(name)?.uncompressedSize,
      read: (name, maxEntryBytes) => {
        const entry = files.get(name);
        if (entry === undefined) {
          return Promise.reject(new Error(`the zip carries no ${name}`));
        }
        return readZipEntryBlob(
          entry,
          budget,
          "application/octet-stream",
          maxEntryBytes,
        );
      },
    });
  });
}

/** The entry `name`'s bytes. Throws, naming it, when the zip lacks it. */
export function readZipBlobEntry(blob: Blob, name: string): Promise<Blob> {
  return withCappedZipEntries(blob, async (entries) => {
    const entry = entries.find(
      (e): e is FileEntry => !e.directory && e.filename === name,
    );
    if (entry === undefined) {
      throw new Error(`the saved tour carries no ${name}`);
    }
    return readZipEntryBlob(
      entry,
      DecompressionBudget.forArchive(blob.size),
      "application/octet-stream",
    );
  });
}
