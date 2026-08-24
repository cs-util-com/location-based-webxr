/**
 * Storage module — OPFS, ZIP export/import, storage abstractions.
 */

// --- storage-backend ---
export {
  type StorageBackend,
  type CreateSessionResult,
} from './storage-backend.js';

// --- null-storage-backend ---
export { NullStorageBackend } from './null-storage-backend.js';

// --- opfs-storage-backend ---
export { OpfsStorageBackend } from './opfs-storage-backend.js';

// --- opfs-storage ---
export {
  type SessionMetadata,
  resetOpfsStorage,
  resetSessionHandles,
  initOpfsStorage,
  createSession,
  getSessionHandle,
  getSessionsRootHandle,
  getAppRootHandle,
  listSessions,
  checkStorageQuota,
  writeSessionMetadata,
} from './opfs-storage.js';

// --- write-file-or-abort ---
export {
  writeFileOrAbort,
  type WritableFileData,
} from './write-file-or-abort.js';

// --- file-system-utils ---
export {
  formatTimestamp,
  formatActionFilename,
  formatFrameFilename,
} from './file-system-utils.js';

// --- ref-point-importer / ref-point-loader / ref-point-recovery —
//     moved to recorder app in Iter 3 of the AppFramework / RecorderApp
//     boundary migration. Recorder consumers import locally now. ---

// --- zip-export ---
export {
  type ZipExportResult,
  type ZipExportContributor,
  type ZipContributorAddFile,
  type ExportSessionAsZipOptions,
  exportSessionAsZip,
  exportSessionHandleAsZip,
  syncToExternalZip,
  downloadZip,
} from './zip-export.js';

// --- zip-reader ---
export {
  type Entry,
  MAX_ACTION_FILE_SIZE,
  type RecordedAction,
  type ZipActionEntry,
  readZipEntries,
  loadActionsFromZip,
  loadSessionMetadata as loadSessionMetadataFromZip,
  loadSessionMetadataFromBlob,
  type GpsPathCoord,
  loadGpsPathFromBlob,
  type ZipSubdirEntry,
  loadEntriesFromSubdir,
} from './zip-reader.js';

// --- zip-coverage-embed ---
export { embedCoverageInSessionJson } from './zip-coverage-embed.js';

// --- zip-entry-path ---
export { assertSafeZipEntryPaths } from './zip-entry-path.js';

// --- pack-files-as-zip ---
export {
  type ZipManifest,
  type ZipManifestEntry,
  ZipPackagingError,
  packFilesAsZip,
} from './pack-files-as-zip.js';
