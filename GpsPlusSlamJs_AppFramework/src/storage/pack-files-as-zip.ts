/**
 * `packFilesAsZip` - write a set of in-memory entries into an UNCOMPRESSED
 * zip. The one store-mode writer for archives built from bytes the caller
 * already holds (the OPFS session exporter in `zip-export.ts` streams from
 * directory handles instead); the rebuild and the coverage embed both go
 * through it.
 *
 * Store mode, not DEFLATE: a range-reading consumer (`open-remote-archive`)
 * slices an entry out as plain bytes with no decompression step - the same
 * convention `zip-export.ts` uses - and the payloads (JPEG, JSON) gain
 * nothing from compression.
 *
 * Absorbed from community PR #321 and hardened per its review: every path
 * is validated through `zip-entry-path.ts` and every payload's type is
 * checked before a byte is written (so a rejected call never leaves a
 * partial archive - and `JSON.stringify` returning `undefined` for an
 * unserialisable value is caught here, not as a mid-write library error),
 * and a failure of the underlying writer surfaces as
 * {@link ZipPackagingError}. The manifest is not special here (the PR had a
 * separate `manifest` parameter): it is an entry like any other, which is
 * what lets the rebuild replace it.
 */

import {
  BlobReader,
  BlobWriter,
  TextReader,
  Uint8ArrayReader,
  ZipWriter,
} from '@zip.js/zip.js';

import { assertSafeZipEntryPaths } from './zip-entry-path.js';

/** One entry to write: bytes (or text) at `path` inside the archive. */
export interface ZipEntryInput {
  readonly path: string;
  readonly data: Blob | Uint8Array | string;
}

/** Every failure this module reports. */
export class ZipPackagingError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ZipPackagingError';
  }
}

/** Store mode: no DEFLATE, so entries stay byte-range readable. */
const STORE_LEVEL = 0;

function readerFor(data: ZipEntryInput['data']) {
  if (typeof data === 'string') return new TextReader(data);
  if (data instanceof Uint8Array) return new Uint8ArrayReader(data);
  return new BlobReader(data);
}

function isWritableData(data: unknown): data is ZipEntryInput['data'] {
  return (
    typeof data === 'string' ||
    data instanceof Uint8Array ||
    data instanceof Blob
  );
}

/** The pre-write checks shared by the packer and the rebuild's new entries:
 *  throws {@link ZipPackagingError} naming the caller. */
export function assertWritableZipEntries(
  entries: readonly ZipEntryInput[],
  caller: string
): void {
  assertSafeNewZipPaths(entries, caller);
  assertWritableZipData(entries, caller);
}

/**
 * The PATH rules alone: shape and no duplicates.
 *
 * Split out because `rebuildZipWithEntries` needs to relax exactly this
 * half - and only for a name the input archive already carries, which it
 * has to repeat verbatim in order to replace that entry. Everything else
 * still applies to every entry, and separating them is what keeps the
 * relaxation from quietly widening (PR #438 review).
 */
export function assertSafeNewZipPaths(
  entries: readonly ZipEntryInput[],
  caller: string
): void {
  try {
    assertSafeZipEntryPaths(entries.map((e) => e.path));
  } catch (err) {
    throw new ZipPackagingError(
      `${caller}: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err }
    );
  }
}

/** The PAYLOAD rule alone: every entry must carry something writable. It
 *  applies to an archive-derived name exactly as to an invented one - the
 *  name says nothing about the bytes. */
export function assertWritableZipData(
  entries: readonly ZipEntryInput[],
  caller: string
): void {
  for (const entry of entries) {
    if (!isWritableData(entry.data)) {
      throw new ZipPackagingError(
        `${caller}: entry '${entry.path}' has no writable data (got ${typeof entry.data}) - a JSON.stringify of an unserialisable value?`
      );
    }
  }
}

/**
 * Write `entries` into an uncompressed zip Blob (`application/zip`). An
 * empty list yields a valid, empty archive.
 *
 * @throws {ZipPackagingError} when any path is unsafe or duplicated or any
 *   payload is not writable (checked before any bytes are written), or when
 *   the writer fails mid-way (the half-built archive is abandoned).
 */
export async function packFilesAsZip(
  entries: readonly ZipEntryInput[]
): Promise<Blob> {
  assertWritableZipEntries(entries, 'packFilesAsZip');
  return writeStoreZip(entries, 'packFilesAsZip');
}

/**
 * The writer alone - NO validation. For callers that validated their own
 * inputs (the rebuild validates only its NEW entries: an archive that
 * opened is re-emitted as it is, whatever its entry names, M1 review #2).
 *
 * @throws {ZipPackagingError} when the writer fails.
 */
export async function writeStoreZip(
  entries: readonly ZipEntryInput[],
  caller: string
): Promise<Blob> {
  const writer = new ZipWriter(new BlobWriter('application/zip'), {
    level: STORE_LEVEL,
  });
  try {
    for (const entry of entries) {
      await writer.add(entry.path, readerFor(entry.data));
    }
    return await writer.close();
  } catch (err) {
    throw new ZipPackagingError(
      `${caller}: writing the archive failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
      { cause: err }
    );
  }
}
