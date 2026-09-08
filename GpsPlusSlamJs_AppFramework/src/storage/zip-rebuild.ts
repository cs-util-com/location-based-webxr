/**
 * `rebuildZipWithEntries` - a new zip from an existing one plus entries
 * added or replaced by path. The Tour Viewer's finish step writes the
 * measured code (`qr/<id>.json`), the content manifest (`tour.json`) and
 * the captured photos into the zip the creator hosted; the coverage embed
 * (`zip-coverage-embed.ts`) replaces `session.json` through the same loop.
 *
 * It is a pure transform `(zip, entries) -> zip`: every entry of the input
 * is read and re-emitted uncompressed through `packFilesAsZip`, so
 * untouched entries stay byte-identical and the archive stays range-
 * readable. Unlike the coverage embed's wrapper it NEVER returns the input
 * on failure - it throws. The caller here is a creator about to upload the
 * result over the hosted file, and an old zip handed back as "rebuilt"
 * would lose the measuring session silently.
 *
 * Memory: the output Blob is whole (zip.js streams entries in, the
 * BlobWriter accumulates), so a recorder zip with hundreds of photos is a
 * whole-file pass; `onProgress` lets the UI say so.
 */

import {
  BlobReader,
  Uint8ArrayWriter,
  ZipReader,
  type FileEntry,
} from '@zip.js/zip.js';

import {
  packFilesAsZip,
  ZipPackagingError,
  type ZipEntryInput,
} from './pack-files-as-zip.js';
import { assertSafeZipEntryPaths } from './zip-entry-path.js';

export interface RebuildZipOptions {
  /** Called after each carried-over entry is read, and once more with
   *  `done === total` after the archive is written. */
  onProgress?: (done: number, total: number) => void;
}

/**
 * Re-emit `zip` with `entries` added, replacing any existing entry at the
 * same path. Directory entries of the input are dropped (paths stay
 * implied by file names, as every writer in this package does).
 *
 * @throws {ZipPackagingError} when `zip` is not a readable archive, when a
 *   new entry path is unsafe or duplicated, or when writing fails. Nothing
 *   partial is ever returned.
 */
export async function rebuildZipWithEntries(
  zip: Blob,
  entries: readonly ZipEntryInput[],
  options: RebuildZipOptions = {}
): Promise<Blob> {
  try {
    assertSafeZipEntryPaths(entries.map((e) => e.path));
  } catch (err) {
    throw packagingError('rebuildZipWithEntries', err);
  }
  const reader = new ZipReader(new BlobReader(zip));
  try {
    const existing = (await reader.getEntries()).filter(
      (e): e is FileEntry => !e.directory
    );
    const total = existing.length + entries.length;
    const carried = await readCarriedEntries(existing, entries, (done) => {
      options.onProgress?.(done, total);
    });
    const out = await packFilesAsZip([...carried, ...entries]);
    options.onProgress?.(total, total);
    return out;
  } catch (err) {
    if (err instanceof ZipPackagingError) throw err;
    throw packagingError(
      'rebuildZipWithEntries: reading the archive failed',
      err
    );
  } finally {
    await reader.close();
  }
}

/** Every existing entry not replaced by a new one, as in-memory inputs. */
async function readCarriedEntries(
  existing: readonly FileEntry[],
  replacements: readonly ZipEntryInput[],
  onRead: (done: number) => void
): Promise<ZipEntryInput[]> {
  const replaced = new Set(replacements.map((e) => e.path));
  const carried: ZipEntryInput[] = [];
  let done = 0;
  for (const entry of existing) {
    if (!replaced.has(entry.filename)) {
      carried.push({
        path: entry.filename,
        data: await entry.getData(new Uint8ArrayWriter()),
      });
    }
    done += 1;
    onRead(done);
  }
  return carried;
}

function packagingError(prefix: string, err: unknown): ZipPackagingError {
  return new ZipPackagingError(
    `${prefix}: ${err instanceof Error ? err.message : String(err)}`,
    { cause: err }
  );
}
