/**
 * External File Storage Module
 *
 * Handles the dual-picker flow for external file storage:
 * 1. `showDirectoryPicker({ mode: 'read' })` - Read access to folder with previous sessions
 * 2. `showSaveFilePicker()` - Write access to save the new session ZIP
 *
 * This replaces the broken "Select folder..." button after the OPFS migration
 * (Issue 1a from 2026-01-27 user feedback).
 *
 * DESKTOP ONLY - this whole path is inert on a phone. Chrome for Android
 * exposes neither `showDirectoryPicker` nor `showSaveFilePicker`, so
 * `isExternalStorageSupported()` is false there and no external sync ever
 * runs. On a phone the session is protected by OPFS (`opfs-storage.ts`),
 * which is the whole reason that module exists.
 *
 * An earlier version of this comment asserted the opposite, and the damage
 * was not to this module - the code is gated and degrades correctly. It was
 * to the next reader: the sentence looked like a measured finding that had
 * superseded the OPFS workaround, and it sent a later design down a path
 * built on a handle that never exists on the device it targeted. The claim
 * is removed, and `retracted-behaviour-claims.test.js` now holds it out.
 *
 * This module does NOT perform actual syncing - that's handled by sync-manager.ts
 * and zip-export.ts using the file handle obtained here.
 */

import { createLogger } from 'gps-plus-slam-app-framework/utils/logger';

const log = createLogger('ExternalStorage');

// ============================================================================
// Types
// ============================================================================

/**
 * Successful folder selection result.
 */
interface ReadFolderSuccess {
  success: true;
  folderName: string;
}

/**
 * Failed folder selection result.
 */
interface ReadFolderFailure {
  success: false;
  reason: 'cancelled' | 'denied' | 'error';
  error?: string;
}

/**
 * Result of folder selection.
 */
type ReadFolderResult = ReadFolderSuccess | ReadFolderFailure;

/**
 * Successful save file selection result.
 */
interface SaveFileSuccess {
  success: true;
  fileName: string;
}

/**
 * Failed save file selection result.
 */
interface SaveFileFailure {
  success: false;
  reason: 'cancelled' | 'denied' | 'error';
  error?: string;
}

/**
 * Result of save file selection.
 */
type SaveFileResult = SaveFileSuccess | SaveFileFailure;

// ============================================================================
// Module State
// ============================================================================

let readFolderHandle: FileSystemDirectoryHandle | null = null;
let saveFileHandle: FileSystemFileHandle | null = null;

// ============================================================================
// Feature Detection
// ============================================================================

/**
 * Check if external file storage APIs are available.
 *
 * Returns true only if both showDirectoryPicker and showSaveFilePicker
 * are available (required for the dual-picker flow).
 */
export function isExternalStorageSupported(): boolean {
  return (
    typeof showDirectoryPicker === 'function' &&
    typeof showSaveFilePicker === 'function'
  );
}

// ============================================================================
// Filename Generation
// ============================================================================

/**
 * Generate a session filename with timestamp only.
 *
 * Format: {YYYY-MM-DD}_{HH-MM-SS}utc.zip
 *
 * Issue 1 (2026-02-26 user feedback): Removed scenario name prefix so the
 * filename starts directly with the date. The file handle's .name property
 * is the single source of truth for the actual filename.
 *
 * @param date - Date to use for timestamp (defaults to now)
 * @returns Safe timestamp-based filename for the session ZIP
 */
export function generateSessionFilename(date: Date = new Date()): string {
  // Format date as YYYY-MM-DD_HH-MM-SS
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const hours = String(date.getUTCHours()).padStart(2, '0');
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');
  const seconds = String(date.getUTCSeconds()).padStart(2, '0');

  const timestamp = `${year}-${month}-${day}_${hours}-${minutes}-${seconds}utc`;

  return `${timestamp}.zip`;
}

// ============================================================================
// Folder Selection (Read-Only)
// ============================================================================

/**
 * Open a directory picker for read access to previous session ZIPs.
 *
 * Chrome for Android does not expose `showDirectoryPicker` at all, so this
 * function is unreachable on a phone - callers are gated on
 * `isExternalStorageSupported()`. The claim that `mode: 'read'` is reliable
 * there is removed as wrong; it was the read half of the same retraction
 * that took the write half out of the header (PR #446 review).
 * The folder handle is stored for later use (e.g., extracting ref points).
 *
 * @returns Result indicating success/failure and folder name
 */
export async function selectReadFolder(): Promise<ReadFolderResult> {
  try {
    log.info('Opening folder picker for read access...');

    const handle = await showDirectoryPicker({ mode: 'read' });
    readFolderHandle = handle;

    log.info('Folder selected:', handle.name);
    return {
      success: true,
      folderName: handle.name,
    };
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));

    // User cancelled - not an error
    if (error instanceof DOMException && error.name === 'AbortError') {
      log.info('Folder selection cancelled by user');
      return {
        success: false,
        reason: 'cancelled',
      };
    }

    // Permission denied
    if (
      error instanceof DOMException &&
      (error.name === 'NotAllowedError' || error.name === 'SecurityError')
    ) {
      log.warn('Folder access denied:', error.message);
      return {
        success: false,
        reason: 'denied',
        error: 'Folder access denied. Please grant permission and try again.',
      };
    }

    // Other error
    log.error('Folder selection failed:', error);
    return {
      success: false,
      reason: 'error',
      error: error.message,
    };
  }
}

// ============================================================================
// Save File Selection
// ============================================================================

/**
 * Open a save file picker to get a writable handle for the session ZIP.
 *
 * Uses `showSaveFilePicker`, which Chrome for Android does not expose - so
 * on a phone this function is never reached, because the caller is gated on
 * `isExternalStorageSupported()`. The claim that it writes reliably there is
 * removed as wrong.
 * The file handle is stored for use by the SyncManager during recording.
 *
 * @param scenarioName - Name of the scenario (used in suggested filename)
 * @returns Result indicating success/failure and filename
 */
export async function selectSaveFile(): Promise<SaveFileResult> {
  try {
    const suggestedName = generateSessionFilename();
    log.info('Opening save file picker, suggested name:', suggestedName);

    const handle = await showSaveFilePicker({
      suggestedName,
      types: [
        {
          description: 'ZIP Archive',
          accept: { 'application/zip': ['.zip'] },
        },
      ],
    });

    saveFileHandle = handle;

    log.info('Save file selected:', handle.name);
    return {
      success: true,
      fileName: handle.name,
    };
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));

    // User cancelled - not an error
    if (error instanceof DOMException && error.name === 'AbortError') {
      log.info('Save file selection cancelled by user');
      return {
        success: false,
        reason: 'cancelled',
      };
    }

    // Permission denied
    if (
      error instanceof DOMException &&
      (error.name === 'NotAllowedError' || error.name === 'SecurityError')
    ) {
      log.warn('Save file access denied:', error.message);
      return {
        success: false,
        reason: 'denied',
        error:
          'File save access denied. Please grant permission and try again.',
      };
    }

    // Other error
    log.error('Save file selection failed:', error);
    return {
      success: false,
      reason: 'error',
      error: error.message,
    };
  }
}

// ============================================================================
// Handle Accessors
// ============================================================================

/**
 * Get the stored read folder handle.
 *
 * @returns The directory handle from selectReadFolder, or null if not selected
 */
export function getReadFolderHandle(): FileSystemDirectoryHandle | null {
  return readFolderHandle;
}

/**
 * Get the stored save file handle.
 *
 * @returns The file handle from selectSaveFile, or null if not selected
 */
export function getSaveFileHandle(): FileSystemFileHandle | null {
  return saveFileHandle;
}

/**
 * Get the actual filename from the save file handle.
 *
 * Issue 1 (2026-02-26 user feedback): This is the single source of truth
 * for the ZIP filename. The .name property returns the exact filename the
 * user confirmed in the save dialog (including any edits they made).
 * Use this instead of re-constructing a filename from internal state.
 *
 * @returns The filename from the save file handle, or null if not selected
 */
export function getSaveFileName(): string | null {
  return saveFileHandle?.name ?? null;
}

// ============================================================================
// State Management
// ============================================================================

/**
 * Reset module state - clears stored handles.
 *
 * Call this when starting a new recording session or for testing.
 */
export function resetExternalStorageState(): void {
  readFolderHandle = null;
  saveFileHandle = null;
}

/**
 * Reset for a new recording session — clears save file handle only.
 *
 * Preserves the read folder handle so the user doesn't have to re-select
 * it when starting another recording (Issue 4, 2026-02-06 user feedback).
 * Each new recording needs its own save file, so that handle is always cleared.
 */
export function resetForNewRecording(): void {
  saveFileHandle = null;
}

/**
 * Check whether the stored read folder handle still has 'granted' permission.
 *
 * Uses `queryPermission({ mode: 'read' })` which does NOT prompt the user.
 * Returns `true` only if the handle exists and the browser confirms the
 * permission is still granted. Returns `false` in all other cases
 * (no handle, permission revoked, handle invalid, etc.).
 *
 * @returns Whether read permission is still granted on the stored folder handle
 */
export async function hasReadFolderPermission(): Promise<boolean> {
  if (!readFolderHandle) {
    return false;
  }
  try {
    const state = await readFolderHandle.queryPermission({ mode: 'read' });
    return state === 'granted';
  } catch {
    return false;
  }
}
