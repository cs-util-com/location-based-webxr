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
  assertSafeNewZipPaths,
  assertWritableZipData,
  writeStoreZip,
  ZipPackagingError,
  type ZipEntryInput,
} from './pack-files-as-zip.js';

/** Two new entries at the same path would be written twice. The shared
 *  path checker cannot see this once archive-derived names are filtered out
 *  of it, so the rebuild states the rule for itself. */
function assertNoDuplicateNewPaths(entries: readonly ZipEntryInput[]): void {
  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.path)) {
      throw new ZipPackagingError(
        `rebuildZipWithEntries: entry '${entry.path}' is a duplicate entry path`
      );
    }
    seen.add(entry.path);
  }
}

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
  const reader = new ZipReader(new BlobReader(zip));
  try {
    const replaced = new Set(entries.map((e) => e.path));
    const all = lastOccurrences(
      (await reader.getEntries()).filter((e): e is FileEntry => !e.directory)
    );
    // Validate only the names this call INVENTS. A caller replacing an
    // existing entry has to name it, and the only name that works is the
    // archive's own - so validating that name applied the module's own rule
    // backwards and refused to write back a name it had just read. The live
    // case was the coverage backfill: it finds `session.json` by suffix, so
    // it tolerates `./session.json`, and then could not re-emit it - the
    // recording was skipped with a log line and no other trace (PR #438
    // review). Re-emitting a name the input already carried is no new
    // hazard; inventing one is, and that is still refused.
    const archiveNames = new Set(all.map((e) => e.filename));
    assertSafeNewZipPaths(
      entries.filter((e) => !archiveNames.has(e.path)),
      'rebuildZipWithEntries'
    );
    // The relaxation above is about the SHAPE of a name and nothing else.
    // Duplicates among the new entries, and payloads that cannot be
    // written, still apply to every one of them - a name the archive
    // happens to carry says nothing about the bytes behind it.
    assertNoDuplicateNewPaths(entries);
    assertWritableZipData(entries, 'rebuildZipWithEntries');
    const existing = all.filter((e) => !replaced.has(e.filename));
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
