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
 * is validated through `zip-entry-path.ts` before a byte is written (so a
 * rejected call never leaves a partial archive), a string that serialises
 * to nothing is rejected, and a failure of the underlying writer surfaces
 * as {@link ZipPackagingError} instead of a raw library error. The manifest
 * is not special here (the PR had a separate `manifest` parameter): it is
 * an entry like any other, which is what lets the rebuild replace it.
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

/**
 * Write `entries` into an uncompressed zip Blob (`application/zip`). An
 * empty list yields a valid, empty archive.
 *
 * @throws {ZipPackagingError} when any path is unsafe, colliding or
 *   duplicated (checked before any bytes are written), or when the writer
 *   fails mid-way (the half-built archive is abandoned).
 */
export async function packFilesAsZip(
  entries: readonly ZipEntryInput[]
): Promise<Blob> {
  try {
    assertSafeZipEntryPaths(entries.map((e) => e.path));
  } catch (err) {
    throw new ZipPackagingError(
      `packFilesAsZip: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err }
    );
  }
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
      `packFilesAsZip: writing the archive failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
      { cause: err }
    );
  }
}
