# ZIP Export Module

## Purpose

Exports OPFS session data as downloadable ZIP files. Also provides periodic sync to external file handles for crash safety during recording.

## Why ZIP?

1. **Universal format**: Readable by all OS archive utilities
2. **Single file**: Easier to share than folder of files
3. **Store mode**: No compression needed (images already compressed), fast packaging

## Library Choice: @zip.js/zip.js

Migrated from `fflate` to `@zip.js/zip.js` because:

1. **Streaming support**: Needed for periodic sync to external file handles
2. **Actively maintained**: Regular updates, good TypeScript support
3. **Web Worker support**: Built-in for non-blocking compression
4. **Append support**: Can prepend existing ZIPs for incremental updates

## Public API

### Types

```typescript
/** Result of a ZIP export operation (Issue #2+#3, 2026-02-06) */
interface ZipExportResult {
  blob: Blob; // The ZIP blob ready for download or sharing
  fileCount: number; // Number of files packaged in the ZIP
}
```

### Export Session (flat layout)

```typescript
import { exportSessionAsZip } from './zip-export';

// Export a flat-layout session under sessions/ — returns blob + file count
const { blob, fileCount } = await exportSessionAsZip(
  'recording-2026-01-26_10-00-00utc'
);
```

### Export an already-resolved session handle

`exportSessionHandleAsZip(sessionHandle, options?)` is the layout-agnostic core.
Consumers with their own on-disk layout (e.g. the recorder, which nests sessions
under a named bucket) resolve their session directory handle themselves and call
this directly, so the framework owns the ZIP schema without knowing how the
handle was located.

```typescript
import { exportSessionHandleAsZip } from './zip-export';

const { blob, fileCount } = await exportSessionHandleAsZip(sessionHandle, {
  contributors: [myRefPointsContributor], // app-specific subdir, optional
});
```

### Download ZIP

```typescript
import { downloadZip } from './zip-export';

// Trigger browser download
const saved = await downloadZip(zipBlob, 'recording-2026-01-26.zip');
// false: the user dismissed the save picker and nothing was written
```

### Sync to External File Handle

```typescript
import { syncToExternalZip } from './zip-export';

// Sync a flat-layout session to the user's chosen file — returns blob + file count
const handle = await window.showSaveFilePicker({ ... });
const { blob, fileCount } = await syncToExternalZip(handle, 'recording-...');
```

This is used by [sync-manager.ts](sync-manager.ts) for periodic crash-safe syncing.

## ZIP Structure

The exported ZIP mirrors the framework-owned OPFS session structure, plus any
subdirs written by caller-supplied extension contributors:

```
{session}.zip
├── session.json          # Session metadata
├── actions/
│   ├── 000001.json       # Redux actions
│   ├── 000002.json
│   └── ...
├── images/               # Captured images (legacy recordings: frames/)
│   ├── frame-000001.jpg
│   ├── frame-000002.jpg
│   └── ...
└── {contributor-subdir}/ # e.g. the recorder's refPoints/ — see ZipExportContributor
    └── ...
```

App-specific sections (e.g. the recorder's `refPoints/`) are written through the
`ZipExportContributor` seam (`options.contributors`), so the framework's ZIP code
never needs to know about them.

## Invariants

1. Uses @zip.js/zip.js library with `level: 0` (store mode, no compression)
2. File paths in ZIP match OPFS paths (relative to session root)
3. Binary data (frames) is preserved exactly
4. Download uses `showSaveFilePicker` when available, falls back to `<a download>`
5. `syncToExternalZip` writes to external file handle via `createWritable()`
6. Files are streamed one at a time into the ZipWriter (not accumulated in memory first). This keeps peak memory proportional to a single file, avoiding OOM on large recordings with many frames.
7. App-specific subdirs are appended via the `ZipExportContributor` seam after the framework-owned files; each contributor is confined to its declared subdir.

## Error Modes

| Error                     | Cause                                                                                          | Recovery                                            |
| ------------------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| "Session not found"       | Invalid session name                                                                           | Check session exists                                |
| AbortError                | User cancelled save dialog                                                                     | `downloadZip` resolves `false`; nothing was written |
| "relative path is unsafe" | A contributor path fails `assertSafeZipEntryPaths` ([zip-entry-path.ts](zip-entry-path.ts.md)) | Fix the contributor; no partial archive is kept     |

## Dependencies

- `@zip.js/zip.js`: ZIP library (actively maintained; supports streaming, Web Worker integration, and incremental updates)

## Tests

- Unit tests: `zip-export.test.ts`
- Uses OPFS mocks to populate session data
- Verifies ZIP structure by unzipping with `@zip.js/zip.js`
