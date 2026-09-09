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
// The authoring draft's file store (Tour Viewer M5), and the key escaping
// it shares with the OSM tile store.
export {
  type DraftFileStore,
  DRAFT_STORE_DIR,
  createDraftFileStore,
  openDraftNamespace,
} from './opfs-draft-store.js';
export { fileNameFor, keyForFileName } from './opfs-file-names.js';

export {
  type ZipExportResult,
  type ZipExportContributor,
  type ZipContributorAddFile,
  type ExportSessionAsZipOptions,
  exportSessionAsZip,
  exportSessionHandleAsZip,
  syncToExternalZip,
  downloadBlob,
  downloadZip,
  PDF_FILE_TYPE,
  ZIP_FILE_TYPE,
  type DownloadFileType,
} from './zip-export.js';

// --- share-or-download (the ONE share-sheet-or-save path) ---
export {
  type ShareOrDownloadResult,
  type ShareOrDownloadDeps,
  canShareFilesOfType,
  prefersFileShare,
  shareOrDownloadBlob,
} from './share-or-download.js';

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

// --- zip-entry-path (the one path rule set every zip writer applies) ---
export { assertSafeZipEntryPaths } from './zip-entry-path.js';

// --- pack-files-as-zip (store-mode writer from in-memory entries) ---
export {
  type ZipEntryInput,
  ZipPackagingError,
  assertWritableZipEntries,
  packFilesAsZip,
  writeStoreZip,
} from './pack-files-as-zip.js';

// --- zip-rebuild (existing zip + entries added/replaced by path) ---
export {
  type RebuildZipOptions,
  rebuildZipWithEntries,
} from './zip-rebuild.js';

// --- byte-source ---
export { type ByteSource, SwitchableByteSource } from './byte-source.js';

// --- range-probe ---
export {
  type ArchiveValidators,
  type ProbeResult,
  type RangeProbeRejectCause,
  type FallbackDecision,
  parseContentRangeTotal,
  decideFallback,
} from './range-probe.js';

// --- remote-range-byte-source ---
export {
  type FetchImpl,
  type RemoteValidatorProbe,
  fetchRemoteValidators,
  probeRemote,
  RangeIgnoredError,
  RemoteRangeByteSource,
} from './remote-range-byte-source.js';

// --- local-cache-byte-source ---
export {
  LocalCacheByteSource,
  type CachedArchive,
  type LocalCacheStore,
  InMemoryLocalCacheStore,
  CacheApiStore,
  requestPersistentStorage,
} from './local-cache-byte-source.js';

// --- bounded-local-cache-store ---
export { BoundedLocalCacheStore } from './bounded-local-cache-store.js';

// --- open-remote-archive ---
export {
  openRemoteArchive,
  OpenRemoteArchiveError,
  type ArchiveReadEvent,
  type ArchiveReadOrigin,
  type OpenedArchive,
  type OpenRemoteArchiveOptions,
} from './open-remote-archive.js';

// --- zip-byte-source-reader ---
export { ByteSourceReader } from './zip-byte-source-reader.js';

// --- share-link ---
export {
  type NormalizeShareUrlOptions,
  normalizeShareUrl,
} from './share-link.js';

// --- structural-read-error ---
export { StructuralReadError } from './structural-read-error.js';
