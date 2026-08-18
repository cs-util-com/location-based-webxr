/**
 * `packFilesAsZip` — bundle a JSON manifest + a set of Blobs into an
 * uncompressed ZIP, entries keyed by caller-supplied paths.
 *
 * **Store mode, not DEFLATE.** Every entry is written with `level: 0` so a
 * range-reading consumer can slice an entry out as plain bytes with no
 * decompression step — the same convention `zip-export.ts` uses for session
 * ZIPs. Compression buys little anyway when payloads are already-compressed
 * formats (GLB, MP3/OGG, JPG/PNG).
 *
 * Generic across apps: this module knows nothing about what the manifest or
 * files mean (a "tour", a "scene", …) — it only guarantees the archive it
 * produces is well-formed and matches what its caller declared.
 */

import { BlobWriter, TextReader, ZipWriter, BlobReader } from '@zip.js/zip.js';

import { assertSafeZipEntryPaths } from './zip-entry-path.js';

/** One file entry: bytes written at `path` inside the archive. */
export interface ZipManifestEntry {
  readonly path: string;
  readonly file: Blob;
}

/** The manifest written at the archive root. */
export interface ZipManifest {
  /** Path of the manifest entry (e.g. `'tour.json'`). */
  readonly path: string;
  /** JSON-serializable manifest content. */
  readonly json: unknown;
}

/** Every failure this module reports: an unusable or colliding entry path. */
export class ZipPackagingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ZipPackagingError';
  }
}

/** Store mode: no DEFLATE, so entries stay byte-range readable. */
const STORE_LEVEL = 0;

/**
 * Bundle `manifest` and `entries` into an uncompressed ZIP Blob.
 *
 * @throws {ZipPackagingError} if any entry path (or the manifest path itself)
 * is unsafe, colliding, or duplicated. Checked before any bytes are written,
 * so a rejected call never leaves a partial archive behind.
 */
export async function packFilesAsZip(
  manifest: ZipManifest,
  entries: readonly ZipManifestEntry[]
): Promise<Blob> {
  try {
    assertSafeZipEntryPaths(
      entries.map((e) => e.path),
      [manifest.path]
    );
  } catch (err) {
    throw new ZipPackagingError(`packFilesAsZip: ${(err as Error).message}`);
  }

  const blobWriter = new BlobWriter('application/zip');
  const zipWriter = new ZipWriter(blobWriter, { level: STORE_LEVEL });

  await zipWriter.add(
    manifest.path,
    new TextReader(JSON.stringify(manifest.json))
  );
  for (const entry of entries) {
    await zipWriter.add(entry.path, new BlobReader(entry.file));
  }

  return zipWriter.close();
}
