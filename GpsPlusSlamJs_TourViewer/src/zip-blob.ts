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

import { ZipReader, type Entry, type FileEntry } from "@zip.js/zip.js";
import {
  ByteSourceReader,
  DecompressionBudget,
  DEFAULT_ARCHIVE_LIMITS,
  listZipEntriesCapped,
  LocalCacheByteSource,
  readZipEntryBlob,
} from "gps-plus-slam-app-framework/storage";

async function withEntries<T>(
  blob: Blob,
  use: (entries: readonly Entry[]) => Promise<T>,
): Promise<T> {
  const reader = new ZipReader(
    new ByteSourceReader(
      new LocalCacheByteSource(blob),
      DEFAULT_ARCHIVE_LIMITS.maxDirectoryBytes,
    ),
  );
  try {
    return await use(
      await listZipEntriesCapped(reader, DEFAULT_ARCHIVE_LIMITS.maxEntries),
    );
  } finally {
    await reader.close();
  }
}

/** The file entries' names, in archive order (directories left out).
 *  Throws for bytes that are not a readable zip, or past the entry cap. */
export function zipBlobEntryNames(blob: Blob): Promise<string[]> {
  return withEntries(blob, (entries) =>
    Promise.resolve(entries.filter((e) => !e.directory).map((e) => e.filename)),
  );
}

/** The entry `name`'s bytes. Throws, naming it, when the zip lacks it. */
export function readZipBlobEntry(blob: Blob, name: string): Promise<Blob> {
  return withEntries(blob, async (entries) => {
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
