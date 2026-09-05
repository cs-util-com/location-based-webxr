/**
 * Zip Reader — utilities for reading recording session zip files.
 *
 * Provides production-ready functions to enumerate zip entries, extract
 * recorded Redux actions, and load session metadata from exported recording
 * zip files. Works with both Node.js (Uint8Array from fs) and browser
 * (Uint8Array from fetch/FileReader) environments.
 *
 * The recording zip format:
 *   actions/000001.json  — Redux action JSON files (1-based, zero-padded)
 *   actions/000002.json
 *   ...
 *   images/frame-000001.jpg  — captured image frames (optional; legacy: frames/)
 *   session.json             — session metadata (optional, see F1 bug)
 */

import {
  ZipReader,
  Uint8ArrayReader,
  BlobReader,
  TextWriter,
  type Entry,
  type FileEntry,
  type Reader,
} from '@zip.js/zip.js';
import { createLogger } from '../utils/logger';

const log = createLogger('ZipReader');

// Re-export Entry type so callers don't need to import @zip.js/zip.js directly.
// (Reader is deliberately NOT re-exported: implementers of lazy readers
// subclass it from '@zip.js/zip.js' directly, and an unused re-export fails
// the workspace knip gate.)
export type { Entry } from '@zip.js/zip.js';

/**
 * Input accepted by the zip-reading helpers: either the full zip bytes
 * (the original behavior) or any zip.js {@link Reader} — e.g. a ranged
 * reader over a file descriptor — so callers scanning many large archives
 * can read only the central directory + the entries they open instead of
 * loading whole files into memory.
 *
 * Reader contract: a single Reader instance may back several helper calls
 * concurrently (see `loadRecording` in gps-plus-slam-recorder, which fans
 * out over three helpers via Promise.all), so `init()` must be idempotent
 * and `readUint8Array(index, length)` must support interleaved ranged reads.
 * The caller owns the underlying resource lifecycle (helpers close their
 * ZipReader wrappers, never the Reader's resource).
 */
export type ZipSource = Uint8Array | Reader<unknown>;

/**
 * Wrap a {@link ZipSource} in a fresh zip.js ZipReader.
 *
 * Exported deliberately: consumers outside this workspace resolve this
 * module from the published dist at runtime and probe
 * `typeof toZipReader === 'function'` as the capability marker for lazy
 * Reader support before passing anything other than Uint8Array (older
 * published versions accept only Uint8Array). Do not rename or remove
 * without treating it as a breaking API change.
 */
export function toZipReader(source: ZipSource): ZipReader<unknown> {
  return new ZipReader(
    source instanceof Uint8Array ? new Uint8ArrayReader(source) : source
  );
}

/**
 * Maximum allowed uncompressed size (in bytes) for a single action or
 * metadata JSON file inside a recording zip. Entries exceeding this limit
 * are rejected before decompression to prevent out-of-memory conditions
 * from malicious or corrupted zip files.
 *
 * 1 MB — generous for Redux action JSON; typical actions are a few KB.
 */
export const MAX_ACTION_FILE_SIZE = 1_048_576; // 1 MB

/** Shape of a single recorded Redux action (type + optional payload). */
export type RecordedAction = { type: string; payload?: unknown };

/**
 * A parsed action entry from a recording zip file.
 */
export interface ZipActionEntry {
  /** 1-based index extracted from the filename (e.g., 1 from "000001.json") */
  index: number;
  /** Original filename within the zip (e.g., "actions/000001.json") */
  filename: string;
  /** Parsed Redux action with type and optional payload */
  action: RecordedAction;
}

/**
 * Read all entries from a zip file.
 *
 * @param data - The zip content as a Uint8Array, or a zip.js Reader for lazy access
 * @returns Array of zip entries (directories and files)
 */
export async function readZipEntries(data: ZipSource): Promise<Entry[]> {
  const reader = toZipReader(data);
  try {
    return await reader.getEntries();
  } finally {
    await reader.close();
  }
}

/**
 * Extract the numeric index from an action filename.
 * Filenames are zero-padded like "000001.json" or "actions/000001.json".
 *
 * @param filename - The entry filename from the zip
 * @returns The numeric index, or NaN if the filename doesn't match the pattern
 */
function extractActionIndex(filename: string): number {
  // Match the last numeric segment before .json
  const match = /(\d+)\.json$/.exec(filename);
  return match ? parseInt(match[1]!, 10) : NaN;
}

/**
 * Load all recorded Redux actions from a zip file.
 *
 * Filters for JSON files in the actions/ directory, parses them, and returns
 * them sorted by filename. That is chronological order for replay because
 * `formatActionFilename` zero-pads the index to six digits, so lexicographic
 * and numeric order agree; the numeric index is extracted only to warn about
 * a name that does not fit the scheme.
 *
 * @param data - The zip content as a Uint8Array, or a zip.js Reader for lazy access
 * @param maxFileSize - Maximum allowed uncompressed size per entry (defaults to MAX_ACTION_FILE_SIZE)
 * @returns Array of action entries sorted by filename
 */
export async function loadActionsFromZip(
  data: ZipSource,
  maxFileSize: number = MAX_ACTION_FILE_SIZE
): Promise<ZipActionEntry[]> {
  const entries = await readZipEntries(data);

  // Filter to action JSON files only
  const actionEntries = entries
    .filter(
      (e) =>
        !e.directory &&
        e.filename.includes('actions/') &&
        e.filename.endsWith('.json')
    )
    .sort((a, b) => a.filename.localeCompare(b.filename));

  const results: ZipActionEntry[] = [];

  for (const entry of actionEntries) {
    if (!entry.directory) {
      if (entry.uncompressedSize > maxFileSize) {
        throw new Error(
          `Action file "${entry.filename}" (${entry.uncompressedSize} bytes) ` +
            `exceeds maximum allowed size of ${maxFileSize} bytes`
        );
      }
      const index = extractActionIndex(entry.filename);
      if (Number.isNaN(index)) {
        log.warn(
          `Unexpected non-numeric action filename: "${entry.filename}". ` +
            'Expected pattern like "actions/000001.json". ' +
            'The file will still be processed.'
        );
      }
      const text = await entry.getData(new TextWriter());
      let action: RecordedAction;
      try {
        const parsed: unknown = JSON.parse(text);
        if (
          typeof parsed !== 'object' ||
          parsed === null ||
          typeof (parsed as RecordedAction).type !== 'string'
        ) {
          log.warn(
            `Skipping "${entry.filename}": parsed JSON is not a valid action (missing "type" string)`
          );
          continue;
        }
        action = parsed as RecordedAction;
      } catch {
        log.warn(
          `Skipping malformed JSON in "${entry.filename}": parse failed`
        );
        continue;
      }
      results.push({
        index,
        filename: entry.filename,
        action,
      });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Shared session-metadata extraction helper (internal)
// ---------------------------------------------------------------------------

/**
 * Extract session metadata from an already-constructed ZipReader.
 *
 * Finds the `session.json` entry, validates its size, extracts and parses it.
 * The reader is always closed in `finally`, so callers must not reuse it.
 *
 * @param reader - An open ZipReader (Uint8ArrayReader or BlobReader based)
 * @param maxFileSize - Maximum allowed uncompressed size for session.json
 * @returns Parsed metadata object, or null if session.json is absent
 */
async function extractSessionMetadataFromReader(
  reader: ZipReader<unknown>,
  maxFileSize: number
): Promise<Record<string, unknown> | null> {
  try {
    const entries = await reader.getEntries();

    const sessionEntry = entries.find(
      (e): e is FileEntry => !e.directory && e.filename.endsWith('session.json')
    );

    if (!sessionEntry) {
      return null;
    }

    if (sessionEntry.uncompressedSize > maxFileSize) {
      throw new Error(
        `Session file "${sessionEntry.filename}" (${sessionEntry.uncompressedSize} bytes) ` +
          `exceeds maximum allowed size of ${maxFileSize} bytes`
      );
    }

    const text = await sessionEntry.getData(new TextWriter());
    return JSON.parse(text) as Record<string, unknown>;
  } finally {
    await reader.close();
  }
}

/**
 * Load session metadata from session.json in the zip file.
 *
 * Returns null if session.json is absent (graceful degradation for
 * recordings created before the metadata writing bug was fixed).
 *
 * @param data - The zip content as a Uint8Array, or a zip.js Reader for lazy access
 * @param maxFileSize - Maximum allowed uncompressed size per entry (defaults to MAX_ACTION_FILE_SIZE)
 * @returns Parsed session metadata, or null if not found
 */
export async function loadSessionMetadata(
  data: ZipSource,
  maxFileSize: number = MAX_ACTION_FILE_SIZE
): Promise<Record<string, unknown> | null> {
  return extractSessionMetadataFromReader(toZipReader(data), maxFileSize);
}

/**
 * Load session metadata from session.json in a zip file provided as a Blob.
 *
 * Unlike `loadSessionMetadata(Uint8Array)`, this variant uses zip.js's
 * BlobReader which reads only the central directory and the target entry
 * from the Blob — not the entire file contents. This is critical for
 * memory-efficient scanning of many large recording zips (e.g., during
 * `discoverScenariosFromZipMetadata`).
 *
 * Since `File` extends `Blob`, this works directly with file handles:
 *   const file = await handle.getFile();
 *   const meta = await loadSessionMetadataFromBlob(file);
 *
 * @param blob - A Blob or File containing the zip data
 * @param maxFileSize - Maximum allowed uncompressed size per entry (defaults to MAX_ACTION_FILE_SIZE)
 * @returns Parsed session metadata, or null if session.json is not found
 */
export async function loadSessionMetadataFromBlob(
  blob: Blob,
  maxFileSize: number = MAX_ACTION_FILE_SIZE
): Promise<Record<string, unknown> | null> {
  return extractSessionMetadataFromReader(
    new ZipReader(new BlobReader(blob)),
    maxFileSize
  );
}

// ---------------------------------------------------------------------------
// GPS path extraction (Blob-based, memory-efficient)
// ---------------------------------------------------------------------------

/** A lightweight GPS coordinate pair (Leaflet convention: lat/lng). */
export interface GpsPathCoord {
  readonly lat: number;
  readonly lng: number;
  /**
   * Horizontal accuracy in meters (1σ), if the source GPS event included it.
   * Used by 2D-map previews to draw a per-event accuracy circle.
   */
  readonly accuracy?: number;
}

/**
 * Extract GPS coordinates from a recording zip provided as a Blob.
 *
 * Uses BlobReader for memory-efficient reading. Reads all action JSON files,
 * identifies `gpsData/recordGpsEvent` actions, and returns only the lightweight
 * `{ lat, lng }` pairs — all other action data is discarded immediately.
 *
 * Returns coordinates in chronological order (sorted by action filename).
 * Returns an empty array if the zip is invalid or contains no GPS actions.
 *
 * @param blob - A Blob or File containing the zip data
 * @param maxFileSize - Maximum allowed uncompressed size per action entry
 * @returns Array of GPS coordinates in chronological order
 */
export async function loadGpsPathFromBlob(
  blob: Blob,
  maxFileSize: number = MAX_ACTION_FILE_SIZE
): Promise<GpsPathCoord[]> {
  const reader = new ZipReader(new BlobReader(blob));
  try {
    const entries = await reader.getEntries();

    const actionEntries = entries
      .filter(
        (e): e is FileEntry =>
          !e.directory &&
          e.filename.includes('actions/') &&
          e.filename.endsWith('.json')
      )
      .sort((a, b) => a.filename.localeCompare(b.filename));

    const coords: GpsPathCoord[] = [];

    for (const entry of actionEntries) {
      if (entry.uncompressedSize > maxFileSize) {
        continue;
      }

      const text = await entry.getData(new TextWriter());
      let action: {
        type?: string;
        payload?: {
          gpsPoint?: {
            latitude?: number;
            longitude?: number;
            latLongAccuracy?: number;
          };
          rawGpsPoint?: {
            latitude?: number;
            longitude?: number;
            latLongAccuracy?: number;
          };
        };
      };
      try {
        action = JSON.parse(text) as typeof action;
      } catch {
        continue;
      }

      // Support both old (gpsPoint) and new (rawGpsPoint) payload formats
      const gps = action.payload?.rawGpsPoint ?? action.payload?.gpsPoint;
      if (
        action.type === 'gpsData/recordGpsEvent' &&
        gps &&
        typeof gps.latitude === 'number' &&
        typeof gps.longitude === 'number'
      ) {
        const accuracy =
          typeof gps.latLongAccuracy === 'number' && gps.latLongAccuracy > 0
            ? gps.latLongAccuracy
            : undefined;
        coords.push({
          lat: gps.latitude,
          lng: gps.longitude,
          ...(accuracy !== undefined ? { accuracy } : {}),
        });
      }
    }

    return coords;
  } catch {
    return [];
  } finally {
    try {
      await reader.close();
    } catch {
      // Swallow close errors (e.g., for corrupted zips)
    }
  }
}

// ---------------------------------------------------------------------------
// Extension contributor reader (Iter 2 of boundary cleanup)
// ---------------------------------------------------------------------------

/**
 * A single file pulled out of a contributor-owned subdirectory inside a
 * recording zip. Returned by {@link loadEntriesFromSubdir}.
 *
 * `getText()` is lazy: callers pay the decompression cost only for files they
 * actually open, so iterating an entire `refPoints/` subdir to harvest a few
 * entries stays cheap.
 */
export interface ZipSubdirEntry {
  /** Filename relative to the subdir (e.g. `'42.json'`, not `'refPoints/42.json'`). */
  readonly relativePath: string;
  /** Original full filename inside the ZIP (`'refPoints/42.json'`). */
  readonly fullPath: string;
  /** Uncompressed size in bytes. */
  readonly uncompressedSize: number;
  /** Lazily decode the entry as UTF-8 text. */
  getText(): Promise<string>;
}

/**
 * Enumerate every file under a single top-level subdirectory of a recording
 * zip. Mirrors the writer-side {@link ZipExportContributor} seam so consumers
 * (typically the recorder) can read back what they wrote without
 * re-implementing zip enumeration.
 *
 * Skips directory entries and files outside `subdir`. Sorts entries by
 * `relativePath` for deterministic iteration. Returns an empty array when
 * the subdir is absent (graceful degradation for older zips).
 *
 * @param data - The zip content as a Uint8Array, or a zip.js Reader for lazy access
 * @param subdir - Top-level subdir to scan (no leading or trailing `/`)
 */
export async function loadEntriesFromSubdir(
  data: ZipSource,
  subdir: string
): Promise<ZipSubdirEntry[]> {
  if (!subdir || subdir.includes('/') || subdir.startsWith('.')) {
    throw new Error(
      `subdir must be a non-empty single path segment, got: ${JSON.stringify(subdir)}`
    );
  }

  const prefix = `${subdir}/`;
  const entries = await readZipEntries(data);

  const matching = entries
    .filter(
      (e): e is FileEntry =>
        !e.directory && e.filename.startsWith(prefix) && e.filename !== prefix
    )
    .sort((a, b) => a.filename.localeCompare(b.filename));

  return matching.map((entry) => ({
    relativePath: entry.filename.slice(prefix.length),
    fullPath: entry.filename,
    uncompressedSize: entry.uncompressedSize,
    getText: () => entry.getData(new TextWriter()),
  }));
}
