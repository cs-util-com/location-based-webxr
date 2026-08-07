# ref-point-importer.ts

## Purpose

Extracts reference points from ZIP files in a folder, enabling reuse of ref points from previous recording sessions. When the user selects a folder containing previous session ZIPs, this module scans all ZIP files, extracts `refPoints/*.json` files, and merges them into a deduplicated list of suggestions.

## Public API

| Export                      | Signature                                                                    | Description                                 |
| --------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------- |
| `importRefPointsFromFolder` | `(folderHandle: FileSystemDirectoryHandle) => Promise<RefPointImportResult>` | Import ref points from all ZIPs in a folder |
| `ImportedRefPoint`          | interface                                                                    | Simplified ref point for suggestions        |
| `RefPointImportResult`      | interface                                                                    | Result with ref points, count, and errors   |

### `ImportedRefPoint`

```typescript
interface ImportedRefPoint {
  id: string; // H3 hex index (resolution 11) — unique spatial identifier
  name: string; // Human-readable display name (what the user typed)
  lat: number; // Latitude from first observation (for proximity suggestions)
  lon: number; // Longitude from first observation
  alt?: number; // Optional altitude
  sourceZipName: string; // Which ZIP this came from
}
```

> **History:** The `name` field was removed in Jan 2026 ([task 1e](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-01-27-user-feedback.md)) when `id` and `name` were identical. It was re-added after the March 2026 H3 migration changed `id` to a hex index while `name` remained the human-readable label. See [2026-04-11-aachen-ref-point-audit.md](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-04-11-aachen-ref-point-audit.md) Issue 1+2.

### `RefPointImportResult`

```typescript
interface RefPointImportResult {
  success: boolean; // Whether import completed (may still have errors)
  refPoints: ImportedRefPoint[]; // Merged, deduplicated ref points
  zipFilesScanned: number; // Number of ZIPs successfully opened
  errors: string[]; // Error messages (malformed JSON, corrupt ZIPs, etc.)
}
```

## Invariants & Assumptions

1. **Read-only folder access**: Uses `showDirectoryPicker({ mode: 'read' })` handle; never writes to the folder
2. **ZIP file detection**: Case-insensitive `.zip` extension check (handles `.ZIP`, `.Zip`, etc.)
3. **Deduplication strategy**: First occurrence wins; if same ref point ID appears in multiple ZIPs, the first is kept
4. **GPS coordinates**: Extracted from the first observation's `gpsPoint.latitude/longitude`
5. **Graceful degradation**: Continues processing even if individual ZIPs or ref point files are corrupt
6. **Library dependency**: Uses `@zip.js/zip.js` for ZIP reading (same as `zip-export.ts`)

## Expected ZIP Structure

The module looks for ref points in this structure within each ZIP:

```
session-YYYY-MM-DD.zip
├── session.json
├── actions/
│   └── *.json
├── frames/
│   └── *.jpg
└── refPoints/          ← Scanned for ref point definitions
    ├── pointA.json
    ├── pointB.json
    └── ...
```

Each `refPoints/*.json` file should match the `RefPointDefinition` schema from `ref-point-loader.ts`.

## Examples

### Basic Usage

```typescript
import { importRefPointsFromFolder } from './ref-point-importer';

// User selects folder via File System Access API
const folderHandle = await window.showDirectoryPicker({ mode: 'read' });

// Import ref points from all ZIPs
const result = await importRefPointsFromFolder(folderHandle);

if (result.success) {
  console.log(
    `Found ${result.refPoints.length} ref points from ${result.zipFilesScanned} ZIPs`
  );

  // Use ref points as suggestions
  for (const rp of result.refPoints) {
    console.log(`${rp.name} at (${rp.lat}, ${rp.lon})`);
  }
} else {
  console.error('Import failed:', result.errors);
}
```

### Error Handling

```typescript
const result = await importRefPointsFromFolder(folderHandle);

// result.success may be true even with some errors (partial success)
if (result.errors.length > 0) {
  console.warn('Some files could not be processed:');
  for (const err of result.errors) {
    console.warn(`  - ${err}`);
  }
}
```

## Tests

Unit tests are in `ref-point-importer.test.ts` covering:

| Test Case                  | What it Verifies                         |
| -------------------------- | ---------------------------------------- |
| Empty folder               | Returns empty array, success=true        |
| Non-ZIP files              | Ignores .txt, .jpg, subdirectories       |
| Single ZIP with ref points | Extracts all ref points correctly        |
| Multiple ZIPs              | Merges ref points from all files         |
| Duplicate IDs              | Keeps first occurrence, deduplicates     |
| ZIP without refPoints/     | Returns empty for that ZIP, no error     |
| Malformed JSON             | Logs error, continues with other files   |
| Corrupt ZIP                | Logs error, continues with other ZIPs    |
| GPS coordinate extraction  | Correctly reads lat/lon from observation |
| Uppercase .ZIP extension   | Handles case-insensitive extension       |
| Source tracking            | Includes `sourceZipName` in result       |
| Full RefPointDefinition    | Canonical type flows through pipeline    |
| ImportedRefPoint fields    | Output fields match GpsPoint field names |
| arPose tuple shape         | Vec3/Quat tuples match validation        |

## Dependencies

- `@zip.js/zip.js` — ZIP reading (BlobReader, ZipReader, TextWriter)
- `ref-point-loader.ts` — `RefPointDefinition` type (single source of truth for ref point schema)
- `../utils/logger` — Logging with module tag

## Related Modules

- `ref-point-loader.ts` — Loads ref points from OPFS scenario folder (not ZIPs)
- `external-file-storage.ts` — Provides the folder handle from `showDirectoryPicker`
- `zip-export.ts` — Exports sessions as ZIPs (inverse operation)
