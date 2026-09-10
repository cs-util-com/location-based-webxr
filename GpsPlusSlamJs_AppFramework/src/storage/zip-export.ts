/**
 * ZIP Export Module
 *
 * Exports OPFS session data as ZIP files for download.
 * Uses @zip.js/zip.js library for streaming ZIP creation and reading.
 *
 * The ZIP uses "store" mode (no compression) because:
 * 1. Images are already compressed (JPEG)
 * 2. Faster packaging
 * 3. Simpler implementation
 *
 * @zip.js/zip.js was chosen over fflate because:
 * - Supports streaming reads and writes (needed for periodic sync to external file)
 * - Can append to existing ZIP files via prependZip
 * - Actively maintained with good TypeScript support
 * - Built-in Web Worker support for non-blocking compression
 */

import { BlobWriter, ZipWriter, BlobReader } from '@zip.js/zip.js';
import { createLogger } from '../utils/logger';
import { getSessionsRootHandle } from './opfs-storage';
import { assertSafeZipEntryPaths } from './zip-entry-path.js';

const log = createLogger('ZipExport');

// ============================================================================
// Types
// ============================================================================

/**
 * Result of a ZIP export operation.
 * Provides the blob and metadata for share + summary display.
 *
 * @see 2026-02-06 User Feedback Issue #2 (Share) and Issue #3 (ZIP Stats)
 */
export interface ZipExportResult {
  /** The ZIP blob ready for download or sharing */
  readonly blob: Blob;
  /** Number of files packaged in the ZIP */
  readonly fileCount: number;
}

/**
 * Helper passed to a {@link ZipExportContributor.contribute} callback for
 * appending blobs to the ZIP under a stable, contributor-owned subdirectory.
 *
 * The framework prepends the contributor's `subdir` to the supplied
 * `relativePath` automatically, so contributors only think in terms of paths
 * relative to their own subdir (e.g. `'42.json'`, not `'refPoints/42.json'`).
 */
export type ZipContributorAddFile = (
  relativePath: string,
  blob: Blob
) => Promise<void>;

/**
 * Extension contributor that lets a consumer (typically the recorder)
 * append app-specific files to a session ZIP without forking the
 * framework's ZIP writer.
 *
 * Each contributor declares a top-level subdirectory it owns inside the
 * ZIP (e.g. the recorder uses `refPoints/`). The framework calls
 * {@link contribute} after writing all framework-owned sections.
 *
 * Contributors must:
 *  - Only write files under their declared `subdir` (the framework enforces
 *    this by routing every `addFile` call through the prefix).
 *  - Tolerate an empty source (e.g. a session with no ref points) by
 *    returning `0` instead of throwing.
 *
 * @see 2026-05-03-appframework-vs-recorderapp-boundary-analysis.md — Iter 2.
 */
export interface ZipExportContributor {
  /** Top-level subdirectory inside the ZIP (no leading or trailing `/`). */
  readonly subdir: string;
  /**
   * Append files for this contributor. Implementations call `addFile`
   * once per file with a path relative to {@link subdir}.
   *
   * @returns Number of files added so the framework's `fileCount` total
   *   stays accurate for download summaries.
   */
  contribute(addFile: ZipContributorAddFile): Promise<number>;
}

/**
 * Options for {@link exportSessionAsZip}.
 */
export interface ExportSessionAsZipOptions {
  /**
   * Optional list of {@link ZipExportContributor}s. Each is invoked after
   * framework-owned sections have been written. Order is preserved in the
   * resulting ZIP central directory but has no semantic effect.
   */
  readonly contributors?: readonly ZipExportContributor[];
}

// ============================================================================
// Internal Helpers
// ============================================================================

/**
 * Get the OPFS sessions directory handle from the layout owner
 * (quality-review G-9 — this used to re-derive the
 * `'gps-plus-slam'/'sessions'` path itself, so a root re-nesting in
 * `opfs-storage.ts` would have silently broken export only).
 */
function getSessionsHandle(): FileSystemDirectoryHandle {
  const sessions = getSessionsRootHandle();
  if (!sessions) {
    throw new Error(
      'OPFS storage not initialized — call initOpfsStorage() before exporting'
    );
  }
  return sessions;
}

/**
 * Stream all files from a directory recursively into a ZipWriter.
 * Files are read one at a time and immediately added to the ZIP,
 * keeping memory usage proportional to a single file (not the total).
 *
 * @returns Number of files added
 */
async function streamDirectoryToZip(
  dirHandle: FileSystemDirectoryHandle,
  zipWriter: ZipWriter<Blob>,
  basePath: string = ''
): Promise<number> {
  let count = 0;

  for await (const entry of dirHandle.values()) {
    const relativePath = basePath ? `${basePath}/${entry.name}` : entry.name;

    if (entry.kind === 'file') {
      const fileHandle = await dirHandle.getFileHandle(entry.name);
      const file = await fileHandle.getFile();
      await zipWriter.add(relativePath, new BlobReader(file));
      count++;
    } else if (entry.kind === 'directory') {
      const subDirHandle = await dirHandle.getDirectoryHandle(entry.name);
      count += await streamDirectoryToZip(
        subDirHandle,
        zipWriter,
        relativePath
      );
    }
  }

  return count;
}

// Per-session ref-point ZIP filtering moved to the recorder app in Iter 3 of
// the AppFramework / RecorderApp boundary cleanup. Recorder consumers now
// register a `ZipExportContributor` via `exportSessionAsZip({ contributors })`.
// See gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-03-appframework-vs-recorderapp-boundary-analysis.md

// ============================================================================
// Public API
// ============================================================================

/**
 * Export a flat-layout session from OPFS as a ZIP blob.
 *
 * The ZIP structure mirrors the OPFS session structure:
 * - session.json (at root)
 * - actions/000001.json, actions/000002.json, ...
 * - images/frame-000001.jpg, images/frame-000002.jpg, ... (legacy: frames/)
 *
 * Uses "store" mode (compression level 0) for fast packaging. Consumers with a
 * different on-disk layout (one that nests sessions under a named bucket)
 * resolve their own session handle and call {@link exportSessionHandleAsZip}.
 *
 * @param sessionName - Name of the session folder under `sessions/`.
 * @returns ZIP export result with blob and file count
 * @throws Error if the session is not found
 */
export async function exportSessionAsZip(
  sessionName: string,
  options?: ExportSessionAsZipOptions
): Promise<ZipExportResult> {
  log.info(`Exporting session: ${sessionName}`);

  const sessionsDir = getSessionsHandle();
  let sessionHandle: FileSystemDirectoryHandle;
  try {
    sessionHandle = await sessionsDir.getDirectoryHandle(sessionName);
  } catch {
    throw new Error(`Session "${sessionName}" not found in OPFS storage`);
  }

  return exportSessionHandleAsZip(sessionHandle, options);
}

/**
 * Stream an already-resolved session directory handle to a ZIP blob, running
 * any caller-supplied extension {@link ZipExportContributor}s after the
 * framework-owned files.
 *
 * This is the layout-agnostic core of {@link exportSessionAsZip}: consumers
 * that resolve a session directory handle themselves (e.g. an app that nests
 * sessions under its own grouping layer) call this directly so the framework's
 * ZIP schema stays the single source of truth without the framework needing to
 * know how the handle was located.
 *
 * @param sessionHandle - The session directory to package (must contain the
 *   framework-owned `session.json` / `actions/` / `images/` tree).
 * @returns ZIP export result with blob and file count.
 */
export async function exportSessionHandleAsZip(
  sessionHandle: FileSystemDirectoryHandle,
  options?: ExportSessionAsZipOptions
): Promise<ZipExportResult> {
  const blobWriter = new BlobWriter('application/zip');
  const zipWriter = new ZipWriter(blobWriter, { level: 0 });

  let fileCount = await streamDirectoryToZip(sessionHandle, zipWriter);

  // Caller-supplied extension contributors. Each owns a single top-level
  // subdir; the framework prepends that subdir to every file path so the
  // contributor cannot accidentally write outside its own namespace.
  const contributors = options?.contributors ?? [];
  const seenSubdirs = new Set<string>();
  for (const contributor of contributors) {
    const subdir = contributor.subdir;
    if (!subdir || subdir.includes('/') || subdir.startsWith('.')) {
      throw new Error(
        `ZipExportContributor.subdir must be a non-empty single path segment, got: ${JSON.stringify(
          subdir
        )}`
      );
    }
    if (seenSubdirs.has(subdir)) {
      throw new Error(
        `Duplicate ZipExportContributor.subdir registered: ${subdir}`
      );
    }
    seenSubdirs.add(subdir);

    const addFile: ZipContributorAddFile = async (relativePath, blob) => {
      // The shared rule set (zip-entry-path.ts): absolute paths, backslashes,
      // '.'/'..' segments, empty segments and trailing slashes are all
      // rejected. Without this, a contributor could escape its declared
      // subdir (e.g. `../actions/000001.json`) and overwrite framework-owned
      // files inside the ZIP. These used to be three inline checks that the
      // validator absorbed from community PR #321 was LAXER than (its
      // review, 2026-08-26); one module now serves every writer (DEC-H3).
      // The COMPOSED path is what reaches the archive, so that is what is
      // validated (M1 review #4: validating the relative half alone let a
      // drive-lettered or backslashed subdir through).
      try {
        assertSafeZipEntryPaths([`${subdir}/${relativePath}`]);
      } catch (err) {
        throw new Error(
          `ZipExportContributor relative path is unsafe: ${err instanceof Error ? err.message : String(err)}`,
          { cause: err }
        );
      }
      await zipWriter.add(`${subdir}/${relativePath}`, new BlobReader(blob));
    };
    fileCount += await contributor.contribute(addFile);
  }

  const blob = await zipWriter.close();
  log.info(`ZIP created: ${blob.size} bytes, ${fileCount} files`);

  return { blob, fileCount };
}

/**
 * Sync current OPFS session data to an external file handle.
 *
 * This is used for periodic sync during recording to save data to the user's
 * chosen location (obtained via showSaveFilePicker). The function:
 * 1. Reads all current session data from OPFS
 * 2. Creates a ZIP in memory
 * 3. Writes the ZIP to the external file handle
 *
 * This provides crash safety combined with OPFS - even if the app crashes,
 * the last synced ZIP contains all data up to that point.
 *
 * @param fileHandle - File handle from showSaveFilePicker
 * @param sessionName - Name of the session folder under `sessions/`
 * @returns ZIP export result with blob and file count
 * @throws Error if the session is not found
 */
export async function syncToExternalZip(
  fileHandle: FileSystemFileHandle,
  sessionName: string,
  options?: ExportSessionAsZipOptions
): Promise<ZipExportResult> {
  log.info(`Syncing to external ZIP: ${sessionName}`);

  // Export session as blob
  const result = await exportSessionAsZip(sessionName, options);

  // Write to external file handle
  const writable = await fileHandle.createWritable();
  await writable.write(result.blob);
  await writable.close();

  log.info(`Synced ${result.blob.size} bytes to external file`);

  return result;
}

/**
 * Trigger a file download in the browser.
 *
 * Uses showSaveFilePicker if available (for better UX on desktop),
 * falls back to <a download> for broader compatibility.
 *
 * @param blob - The blob to download
 * @param filename - Suggested filename
 * @returns `true` when a download or save was started; `false` when the
 *   user dismissed the save picker, in which case nothing was written. A
 *   caller whose next step assumes the file exists (the Tour Viewer's
 *   finish step) keeps its download control live on `false`; before this
 *   result the cancelled path was silent.
 */
export async function downloadZip(
  blob: Blob,
  filename: string
): Promise<boolean> {
  return downloadBlob(blob, filename, ZIP_FILE_TYPE);
}

/** What the save picker offers to filter by. */
export interface DownloadFileType {
  /** Shown in the picker's filter row, e.g. "ZIP Archive". */
  description: string;
  /** The MIME type, e.g. `application/pdf`. */
  mimeType: string;
  /** The extension WITH its dot, e.g. `.pdf`. */
  extension: string;
}

/** A recording or tour archive - the type both apps' zips are saved as. */
export const ZIP_FILE_TYPE: DownloadFileType = {
  description: 'ZIP Archive',
  mimeType: 'application/zip',
  extension: '.zip',
};

/** A printable document - the Tour Viewer's sheet of numbered codes. */
export const PDF_FILE_TYPE: DownloadFileType = {
  description: 'PDF Document',
  mimeType: 'application/pdf',
  extension: '.pdf',
};

/**
 * Trigger a file download, with the picker filtered to `fileType`.
 *
 * Generalised from `downloadZip` when a second kind of file needed the same
 * save path (the printable PDF of QR codes): the picker's type filter was
 * the only zip-specific thing in it, and a second copy of the
 * picker-then-anchor dance is exactly the duplication this repo keeps
 * finding. `downloadZip` stays as the zip-shaped call its callers already
 * make.
 *
 * @returns `true` when a download or save was started; `false` when the
 *   user dismissed the save picker, in which case nothing was written.
 */
export async function downloadBlob(
  blob: Blob,
  filename: string,
  fileType: DownloadFileType
): Promise<boolean> {
  // Try File System Access API first (better UX on desktop)
  if ('showSaveFilePicker' in window && window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [
          {
            description: fileType.description,
            accept: { [fileType.mimeType]: [fileType.extension] },
          },
        ],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      log.info(`Saved via File System Access API: ${filename}`);
      return true;
    } catch (err) {
      const error = err as Error;
      if (error.name === 'AbortError') {
        // User cancelled - don't fall through
        log.info('User cancelled save dialog');
        return false;
      }
      // Fall through to <a download> fallback
      log.warn('showSaveFilePicker failed, using fallback:', error.message);
    }
  }

  // Fallback: <a download> approach
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  // Clean up the object URL after a delay. TEN seconds, not one: the
  // recorder's own copy of this fallback carried that value with a reason -
  // on slower Android browsers the click event can propagate
  // asynchronously, and revoking too early cancels the download. When the
  // two copies were merged (r665) the longer, reasoned value won; nothing
  // depends on the URL being released sooner.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);

  log.info(`Download triggered via <a download>: ${filename}`);
  return true;
}
