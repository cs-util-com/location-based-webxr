# zip-reader.ts

## Purpose

Production-ready utilities for reading recording session ZIP files exported by the RecorderApp. Extracts Redux action JSON files and session metadata, enabling replay, import, and validation workflows.

## Public API

### `ZipSource` (type) and `toZipReader(source: ZipSource): ZipReader`

`ZipSource = Uint8Array | Reader<unknown>` is the input accepted by `readZipEntries`, `loadActionsFromZip`, `loadSessionMetadata`, and `loadEntriesFromSubdir`: either the full zip bytes (original behavior, byte-identical results) or any zip.js `Reader` — e.g. a ranged reader over a file descriptor — so callers scanning many large archives read only the central directory + the entries they open instead of loading whole files into memory (added 2026-07-09 for the Investigation corpus gate, see that repo's `docs/2026-07-09-1944-regression-gate-budget-breach-followup.md`).

- **Reader contract:** one Reader instance may back several helper calls concurrently (`loadRecording` fans out via `Promise.all`), so `init()` must be idempotent and `readUint8Array(index, length)` must support interleaved ranged reads. Helpers close their `ZipReader` wrappers but never the Reader's underlying resource — the caller owns that lifecycle. Lazy `getText()` on `ZipSubdirEntry` must keep working after the helper returned.
- **`toZipReader` is the runtime capability marker:** external consumers resolving this module from the published dist probe `typeof toZipReader === 'function'` before passing Readers (older published versions accept only `Uint8Array`). Renaming/removing it is a breaking API change.
- The zip.js `Reader` base class is deliberately not re-exported (lazy-reader implementers subclass it from `@zip.js/zip.js` directly; an unused re-export fails the workspace knip gate).

### `readZipEntries(data: ZipSource): Promise<Entry[]>`

Opens a ZIP file and returns all entries (directories and files). Uses `@zip.js/zip.js` internally. The reader is properly closed after enumeration.

- **Input:** ZIP bytes as `Uint8Array`, or a zip.js `Reader` (see `ZipSource`)
- **Output:** Array of `Entry` objects from `@zip.js/zip.js`
- **Errors:** Throws if the data is not a valid ZIP file

### `loadActionsFromZip(data: ZipSource, maxFileSize?: number): Promise<ZipActionEntry[]>`

Extracts all action JSON files from the `actions/` directory in the ZIP, parses them, and returns them sorted by filename — chronological because `formatActionFilename` zero-pads the index to six digits (see the invariant below).

- **Input:** ZIP file bytes as `Uint8Array`; optional `maxFileSize` (defaults to `MAX_ACTION_FILE_SIZE` = 1 MB)
- **Output:** Array of `ZipActionEntry` objects, each containing:
  - `index` — 1-based numeric index from zero-padded filename (e.g., 1 from `000001.json`). Returns `NaN` for non-numeric filenames.
  - `filename` — original path within the ZIP (e.g., `actions/000001.json`)
  - `action` — parsed Redux action (`RecordedAction`: `{ type: string; payload?: unknown }`)
- **Warnings:** Logs a warning via `createLogger('ZipReader')` for any action file whose filename doesn't match the expected numeric pattern (e.g., `actions/my-notes.json`). The file is still processed and included in results. Also logs a warning for any action file that fails JSON parsing — the file is skipped, and remaining actions are still returned.
- **Errors:** Throws if any action entry's `uncompressedSize` exceeds `maxFileSize` (DoS protection). Malformed JSON in individual action files is handled gracefully (skip + warn) rather than aborting the entire load — consistent with `loadGpsPathFromBlob`'s error-handling pattern.

### `loadSessionMetadata(data: Uint8Array, maxFileSize?: number): Promise<Record<string, unknown> | null>`

Reads `session.json` from the ZIP if present. Returns `null` when the file is absent (graceful degradation for recordings affected by bug F1 where `writeSessionMetadata` is never called in production).

- **Input:** ZIP file bytes as `Uint8Array`; optional `maxFileSize` (defaults to `MAX_ACTION_FILE_SIZE` = 1 MB)
- **Output:** Parsed metadata object, or `null` if `session.json` is missing
- **Errors:** Throws if `session.json` `uncompressedSize` exceeds `maxFileSize` (DoS protection)

### `loadSessionMetadataFromBlob(blob: Blob, maxFileSize?: number): Promise<Record<string, unknown> | null>`

Memory-efficient variant of `loadSessionMetadata` that accepts a `Blob` (or `File`, since `File extends Blob`). Uses `BlobReader` internally so zip.js reads only the central directory and the `session.json` entry — **not** the entire file contents. This is critical for `discoverScenariosFromZipMetadata` which scans many potentially-large recording zips.

- **Input:** `Blob` or `File` containing ZIP data; optional `maxFileSize` (defaults to `MAX_ACTION_FILE_SIZE` = 1 MB)
- **Output:** Parsed metadata object, or `null` if `session.json` is missing
- **Errors:** Throws if `session.json` `uncompressedSize` exceeds `maxFileSize` (DoS protection)

### `RecordedAction` (type)

Canonical shape of a single recorded Redux action, shared across production and test code:

```typescript
type RecordedAction = { type: string; payload?: unknown };
```

### `ZipActionEntry` (type)

```typescript
interface ZipActionEntry {
  index: number;
  filename: string;
  action: RecordedAction;
}
```

### `MAX_ACTION_FILE_SIZE` (constant)

Maximum allowed uncompressed size (in bytes) for a single action or metadata JSON file: **1,048,576 bytes (1 MB)**. Entries exceeding this limit are rejected before decompression to prevent OOM from malicious or corrupted zip files.

### `loadGpsPathFromBlob(blob: Blob, maxFileSize?: number): Promise<GpsPathCoord[]>`

Memory-efficient GPS coordinate extractor for the replay preview map. Uses `BlobReader` to read action JSON files from the zip, identifies `gpsData/recordGpsEvent` actions, and returns lightweight `{ lat, lng }` pairs — all other action data is discarded immediately. Supports both new (`rawGpsPoint`) and old (`gpsPoint`) payload formats for backward compatibility.

- **Input:** `Blob` or `File` containing ZIP data; optional `maxFileSize` (defaults to `MAX_ACTION_FILE_SIZE` = 1 MB)
- **Output:** Array of `GpsPathCoord` in chronological order (sorted by action filename)
- **Error handling:** Returns `[]` for invalid/corrupted zips (no throw). Skips action files that exceed `maxFileSize` or fail JSON parsing.

### `GpsPathCoord` (type)

```typescript
interface GpsPathCoord {
  readonly lat: number;
  readonly lng: number;
}
```

## Internal Helpers

### `extractSessionMetadataFromReader(reader, maxFileSize)` (private)

Shared implementation for both `loadSessionMetadata` and `loadSessionMetadataFromBlob`. Finds `session.json`, validates size, extracts and parses it. The reader is always closed in `finally`, so callers must not reuse it. Both public functions are thin wrappers that only differ in reader construction (`Uint8ArrayReader` vs `BlobReader`).

## Invariants & Assumptions

- ZIP files follow the RecorderApp export format: `actions/NNNNNN.json` for actions, optional `frames/` for images, optional `session.json` for metadata.
- Action filenames use 6-digit zero-padded indices starting at 1 (e.g., `000001.json`).
- Actions are sorted by `filename.localeCompare()` which preserves numeric order for zero-padded names.
- The `Uint8Array` input works with both `fs.readFileSync()` (Node.js/tests) and `fetch().arrayBuffer()` (browser).
- `@zip.js/zip.js` is the only ZIP library dependency; its `Entry` type is re-exported for convenience.
- **Size guard**: Every entry is checked against `maxFileSize` (default 1 MB) before decompression. This prevents DoS from zip bombs or oversized entries.
- **No code duplication**: Session metadata extraction logic exists in a single private helper (`extractSessionMetadataFromReader`), preventing copy-paste drift between the `Uint8Array` and `Blob` paths.

## Examples

```typescript
import { loadActionsFromZip, loadSessionMetadata } from './zip-reader';

// Node.js (tests)
const data = new Uint8Array(fs.readFileSync('recording.zip'));

// Browser
const resp = await fetch('recording.zip');
const data = new Uint8Array(await resp.arrayBuffer());

// Load actions for replay
const actions = await loadActionsFromZip(data);
for (const { action } of actions) {
  store.dispatch(action);
}

// Load session metadata (may be null)
const meta = await loadSessionMetadata(data);
```

## Tests

- Unit tests: `zip-reader.test.ts` — covering entry reading, action loading, index extraction, payload preservation, graceful null return for missing `session.json`, size-limit enforcement for both actions and session metadata, warning logging for non-numeric action filenames, malformed JSON resilience (skip + warn + return remaining valid actions), `loadSessionMetadataFromBlob` (Blob-based metadata reading with BlobReader), `loadGpsPathFromBlob` (GPS-only extraction including happy path, filtering, empty GPS, corrupted zip, File support, and chronological ordering), and the `ZipSource` lazy-Reader path (result equivalence vs `Uint8Array` for all four helpers, lazy `getText()` after helper return, concurrent triple use of one shared Reader instance, `toZipReader` capability-marker pin).
- Integration consumer: `recording-replay.integration.test.ts` — uses `loadActionsFromZip` and `loadSessionMetadata` for full replay verification.
- Test data: produced programmatically via `produceTestZip()` from `test-utils/zip-round-trip-helpers.ts` — no static test zip files.
