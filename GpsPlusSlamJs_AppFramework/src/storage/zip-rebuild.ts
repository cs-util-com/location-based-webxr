/**
 * `rebuildZipWithEntries` - a new zip from an existing one plus entries
 * added or replaced by path. The Tour Viewer's finish step writes the
 * measured code (`qr/<id>.json`), the content manifest (`tour.json`) and
 * the captured photos into the zip the creator hosted; the coverage embed
 * (`zip-coverage-embed.ts`) replaces `session.json` through the same loop.
 *
 * It is a pure transform `(zip, entries) -> zip`: every entry of the input
 * is read and re-emitted uncompressed through the store-mode writer, so
 * untouched entries stay byte-identical and the archive stays range-
 * readable. Unlike the coverage embed's wrapper it NEVER returns the input
 * on failure - it throws. The caller here is a creator about to upload the
 * result over the hosted file, and an old zip handed back as "rebuilt"
 * would lose the measuring session silently.
 *
 * Two rules from the M1 review of the guided-setup plan:
 * - Carried entries are read into BLOBS, not `Uint8Array`s: a browser keeps
 *   Blobs off the JS heap, so the peak cost is the output archive, not the
 *   input twice over (review #1; a recorder zip is hundreds of photos).
 * - Only the NEW entries are validated. An archive that opened is
 *   re-emitted as it is, whatever its entry names (review #2): a duplicate
 *   name or a `./` segment in a hosted zip is not the creator's fault, and
 *   a rebuild that refused it would dead-end the setup. Duplicate names in
 *   the input collapse to the LAST occurrence, which is what readers
 *   resolve.
 */

import {
  BlobReader,
  BlobWriter,
  ZipReader,
  type FileEntry,
} from '@zip.js/zip.js';

import {
  assertWritableZipEntries,
  writeStoreZip,
  ZipPackagingError,
  type ZipEntryInput,
} from './pack-files-as-zip.js';

export interface RebuildZipOptions {
  /** Called after each carried-over entry is read (`done` = entries read
   *  so far, `total` = the entry count the OUTPUT will have), and once more
   *  with `done === total` after the archive is written. */
  onProgress?: (done: number, total: number) => void;
}

/**
 * Re-emit `zip` with `entries` added, replacing any existing entry at the
 * same path. Directory entries of the input are dropped (paths stay
 * implied by file names, as every writer in this package does).
 *
 * @throws {ZipPackagingError} when `zip` is not a readable archive, when a
 *   NEW entry path is unsafe or duplicated or its data is not writable, or
 *   when writing fails. Nothing partial is ever returned.
 */
export async function rebuildZipWithEntries(
  zip: Blob,
  entries: readonly ZipEntryInput[],
  options: RebuildZipOptions = {}
): Promise<Blob> {
  assertWritableZipEntries(entries, 'rebuildZipWithEntries');
  const reader = new ZipReader(new BlobReader(zip));
  try {
    const replaced = new Set(entries.map((e) => e.path));
    const existing = lastOccurrences(
      (await reader.getEntries()).filter((e): e is FileEntry => !e.directory)
    ).filter((e) => !replaced.has(e.filename));
    const total = existing.length + entries.length;
    const carried: ZipEntryInput[] = [];
    for (const entry of existing) {
      carried.push({
        path: entry.filename,
        data: await entry.getData(new BlobWriter()),
      });
      options.onProgress?.(carried.length, total);
    }
    const out = await writeStoreZip(
      [...carried, ...entries],
      'rebuildZipWithEntries'
    );
    options.onProgress?.(total, total);
    return out;
  } catch (err) {
    if (err instanceof ZipPackagingError) throw err;
    throw new ZipPackagingError(
      `rebuildZipWithEntries: reading the archive failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
      { cause: err }
    );
  } finally {
    await reader.close();
  }
}

/** Input order, each name once, the LAST occurrence kept. */
function lastOccurrences(entries: readonly FileEntry[]): FileEntry[] {
  const byName = new Map<string, FileEntry>();
  for (const entry of entries) byName.set(entry.filename, entry);
  return [...byName.values()];
}
