# External File Storage Module

## Purpose

Handles the dual-picker flow for external file storage (Issue 1a from 2026-01-27 user feedback). This replaces the broken "Select folder..." button that became non-functional after the OPFS migration.

## Public API

### Feature Detection

- `isExternalStorageSupported(): boolean` — Returns true if both `showDirectoryPicker` and `showSaveFilePicker` are available.

### Folder Selection (Read-Only)

- `selectReadFolder(): Promise<ReadFolderResult>` — Opens directory picker with `mode: 'read'` for accessing previous session ZIPs. Stores handle for later ref point extraction.

### Save File Selection

- `selectSaveFile(): Promise<SaveFileResult>` — Opens save file picker for the new session ZIP. Suggests a timestamp-based filename. Stores handle for use by SyncManager.

### Handle Accessors

- `getReadFolderHandle(): FileSystemDirectoryHandle | null` — Returns stored folder handle.
- `getSaveFileHandle(): FileSystemFileHandle | null` — Returns stored file handle.
- `getSaveFileName(): string | null` — Returns `saveFileHandle.name` if a handle is stored, or `null`. Single source of truth for the ZIP filename chosen by the user.

### Utilities

- `generateSessionFilename(date?: Date): string` — Generates a timestamp-only filename like `2026-01-30_14-30-45utc.zip`. No scenario prefix.
- `resetExternalStorageState(): void` — Clears stored handles (for testing or new sessions).

### Soft Reset (Issue 4)

- `resetForNewRecording(): void` — Clears only the save file handle while preserving the read folder handle, enabling folder reuse across recordings.
- `hasReadFolderPermission(): Promise<boolean>` — Checks whether the stored read folder handle still has read permission using `queryPermission({ mode: 'read' })`. Does **not** prompt the user. Returns `false` if no handle exists or if `queryPermission` throws.

## Types

```typescript
type ReadFolderResult =
  | { success: true; folderName: string }
  | {
      success: false;
      reason: 'cancelled' | 'denied' | 'error';
      error?: string;
    };

type SaveFileResult =
  | { success: true; fileName: string }
  | {
      success: false;
      reason: 'cancelled' | 'denied' | 'error';
      error?: string;
    };
```

## Invariants & Assumptions

1. **Desktop only, inert on Android**: Chrome for Android exposes neither `showDirectoryPicker` nor `showSaveFilePicker`, so `isExternalStorageSupported()` returns false there and the periodic external sync described above simply never happens on a phone. The earlier claim that these two pickers are reliable on Android Chrome is removed as wrong - phone-side crash safety comes from OPFS (`opfs-storage.ts`) instead, which is why that module exists. Worth knowing before it changes: if the pickers ever do ship on Android, this gate starts returning true on its own and an untested path goes live on the device it was never exercised on.
2. **Handles are stored, not returned directly**: The module stores handles internally to prevent stale reference issues.
3. **Cancellation is not an error**: User cancelling a picker returns `{ success: false, reason: 'cancelled' }` without an error message.
4. **Timestamp-only filenames**: Filenames use UTC timestamp format `YYYY-MM-DD_HH-MM-SSutc.zip` with no scenario prefix. The user can rename in the save picker if desired.

## Examples

```typescript
import {
  isExternalStorageSupported,
  selectReadFolder,
  selectSaveFile,
  getSaveFileHandle,
} from './external-file-storage';

// Check support
if (!isExternalStorageSupported()) {
  console.log('Falling back to OPFS-only mode');
}

// Step 1: Select folder with previous recordings (read-only)
const folderResult = await selectReadFolder();
if (folderResult.success) {
  console.log('Reading from:', folderResult.folderName);
  // Extract ref points from previous ZIPs...
}

// Step 2: Select save location for new session
const saveResult = await selectSaveFile();
if (saveResult.success) {
  console.log('Will save to:', saveResult.fileName);

  // Get the filename the user chose (may differ from suggestion)
  const name = getSaveFileName(); // e.g. '2026-01-30_14-30-45utc.zip'

  // Get handle for SyncManager
  const handle = getSaveFileHandle();
  if (handle) {
    // Pass to syncToExternalZip()...
  }
}
```

## Tests

- Unit tests: [external-file-storage.test.ts](external-file-storage.test.ts)
- 25 tests covering:
  - Feature detection (3 tests)
  - Folder selection success/cancel/error (4 tests)
  - Save file selection success/cancel/error (4 tests)
  - State management (1 test)
  - Error handling (2 tests)
  - Timestamp-only filename generation (3 tests)
  - `getSaveFileName` accessor (2 tests)
  - Soft reset: `resetForNewRecording` clears save handle, preserves read handle (3 tests)
  - Permission check: `hasReadFolderPermission` granted/denied/error (3 tests)

## Related Files

- [sync-manager.ts](sync-manager.ts) — Uses the save file handle for periodic sync
- [zip-export.ts](zip-export.ts) — `syncToExternalZip()` writes to the file handle
- [file-system.ts](file-system.ts) — OPFS-based storage (internal, always used)
