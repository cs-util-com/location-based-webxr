/**
 * Tests for External File Storage Module
 *
 * Why this test file matters:
 * The external file storage module handles the dual-picker flow (Issue 1a from 2026-01-27 user feedback):
 * 1. `showDirectoryPicker({ mode: 'read' })` to read previous session ZIPs for ref point import
 * 2. `showSaveFilePicker()` to get a writable handle for the new session ZIP
 *
 * This replaces the broken "Select folder..." button which became non-functional
 * after the OPFS migration.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Module under test - will be imported after implementation
// import {
//   selectReadFolder,
//   selectSaveFile,
//   getSaveFileHandle,
//   getReadFolderHandle,
//   resetExternalStorageState,
//   isExternalStorageSupported,
// } from './external-file-storage';

describe('external-file-storage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ============================================================================
  // Feature Detection Tests
  // ============================================================================

  describe('isExternalStorageSupported', () => {
    it('returns true when both showDirectoryPicker and showSaveFilePicker are available', async () => {
      // Arrange
      const mockShowDirectoryPicker = vi.fn();
      const mockShowSaveFilePicker = vi.fn();
      vi.stubGlobal('showDirectoryPicker', mockShowDirectoryPicker);
      vi.stubGlobal('showSaveFilePicker', mockShowSaveFilePicker);

      // Act & Assert
      const { isExternalStorageSupported } =
        await import('./external-file-storage');
      expect(isExternalStorageSupported()).toBe(true);
    });

    it('returns false when showDirectoryPicker is not available', async () => {
      // Arrange
      vi.stubGlobal('showDirectoryPicker', undefined);
      vi.stubGlobal('showSaveFilePicker', vi.fn());

      // Act & Assert - need to reimport to get fresh module
      vi.resetModules();
      const { isExternalStorageSupported } =
        await import('./external-file-storage');
      expect(isExternalStorageSupported()).toBe(false);
    });

    it('returns false when showSaveFilePicker is not available', async () => {
      // Arrange
      vi.stubGlobal('showDirectoryPicker', vi.fn());
      vi.stubGlobal('showSaveFilePicker', undefined);

      // Act & Assert
      vi.resetModules();
      const { isExternalStorageSupported } =
        await import('./external-file-storage');
      expect(isExternalStorageSupported()).toBe(false);
    });
  });

  // ============================================================================
  // Read Folder Selection Tests
  // ============================================================================

  describe('selectReadFolder', () => {
    it('calls showDirectoryPicker with mode: "read"', async () => {
      // Arrange
      const mockDirHandle = { kind: 'directory', name: 'test-folder' };
      const mockPicker = vi.fn().mockResolvedValue(mockDirHandle);
      vi.stubGlobal('showDirectoryPicker', mockPicker);
      vi.stubGlobal('showSaveFilePicker', vi.fn());

      // Act
      vi.resetModules();
      const { selectReadFolder, resetExternalStorageState } =
        await import('./external-file-storage');
      resetExternalStorageState();

      const result = await selectReadFolder();

      // Assert
      expect(mockPicker).toHaveBeenCalledWith({ mode: 'read' });
      expect(result).toEqual({
        success: true,
        folderName: 'test-folder',
      });
    });

    it('returns success: false with reason "cancelled" when user aborts', async () => {
      // Arrange
      const abortError = new DOMException('User cancelled', 'AbortError');
      const mockPicker = vi.fn().mockRejectedValue(abortError);
      vi.stubGlobal('showDirectoryPicker', mockPicker);
      vi.stubGlobal('showSaveFilePicker', vi.fn());

      // Act
      vi.resetModules();
      const { selectReadFolder, resetExternalStorageState } =
        await import('./external-file-storage');
      resetExternalStorageState();

      const result = await selectReadFolder();

      // Assert
      expect(result).toEqual({
        success: false,
        reason: 'cancelled',
      });
    });

    it('returns success: false with reason "denied" when permission denied', async () => {
      // Arrange
      const deniedError = new DOMException(
        'Permission denied',
        'NotAllowedError'
      );
      const mockPicker = vi.fn().mockRejectedValue(deniedError);
      vi.stubGlobal('showDirectoryPicker', mockPicker);
      vi.stubGlobal('showSaveFilePicker', vi.fn());

      // Act
      vi.resetModules();
      const { selectReadFolder, resetExternalStorageState } =
        await import('./external-file-storage');
      resetExternalStorageState();

      const result = await selectReadFolder();

      // Assert
      expect(result).toEqual({
        success: false,
        reason: 'denied',
        error: expect.stringContaining('denied'),
      });
    });

    it('stores the folder handle for later retrieval', async () => {
      // Arrange
      const mockDirHandle = { kind: 'directory', name: 'my-recordings' };
      const mockPicker = vi.fn().mockResolvedValue(mockDirHandle);
      vi.stubGlobal('showDirectoryPicker', mockPicker);
      vi.stubGlobal('showSaveFilePicker', vi.fn());

      // Act
      vi.resetModules();
      const {
        selectReadFolder,
        getReadFolderHandle,
        resetExternalStorageState,
      } = await import('./external-file-storage');
      resetExternalStorageState();

      await selectReadFolder();
      const handle = getReadFolderHandle();

      // Assert
      expect(handle).toBe(mockDirHandle);
    });
  });

  // ============================================================================
  // Save File Selection Tests
  // ============================================================================

  describe('selectSaveFile', () => {
    it('calls showSaveFilePicker with suggested name based on timestamp', async () => {
      // Arrange
      const mockFileHandle = {
        kind: 'file',
        name: 'session-2026-01-30_12-00-00.zip',
      };
      const mockPicker = vi.fn().mockResolvedValue(mockFileHandle);
      vi.stubGlobal('showSaveFilePicker', mockPicker);
      vi.stubGlobal('showDirectoryPicker', vi.fn());

      // Act
      vi.resetModules();
      const { selectSaveFile, resetExternalStorageState } =
        await import('./external-file-storage');
      resetExternalStorageState();

      const result = await selectSaveFile();

      // Assert
      expect(mockPicker).toHaveBeenCalledWith(
        expect.objectContaining({
          suggestedName: expect.stringMatching(
            /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}utc\.zip$/
          ),
          types: [
            {
              description: 'ZIP Archive',
              accept: { 'application/zip': ['.zip'] },
            },
          ],
        })
      );
      expect(result).toEqual({
        success: true,
        fileName: mockFileHandle.name,
      });
    });

    it('returns success: false with reason "cancelled" when user aborts', async () => {
      // Arrange
      const abortError = new DOMException('User cancelled', 'AbortError');
      const mockPicker = vi.fn().mockRejectedValue(abortError);
      vi.stubGlobal('showSaveFilePicker', mockPicker);
      vi.stubGlobal('showDirectoryPicker', vi.fn());

      // Act
      vi.resetModules();
      const { selectSaveFile, resetExternalStorageState } =
        await import('./external-file-storage');
      resetExternalStorageState();

      const result = await selectSaveFile();

      // Assert
      expect(result).toEqual({
        success: false,
        reason: 'cancelled',
      });
    });

    it('stores the file handle for later retrieval', async () => {
      // Arrange
      const mockFileHandle = { kind: 'file', name: 'test.zip' };
      const mockPicker = vi.fn().mockResolvedValue(mockFileHandle);
      vi.stubGlobal('showSaveFilePicker', mockPicker);
      vi.stubGlobal('showDirectoryPicker', vi.fn());

      // Act
      vi.resetModules();
      const { selectSaveFile, getSaveFileHandle, resetExternalStorageState } =
        await import('./external-file-storage');
      resetExternalStorageState();

      await selectSaveFile();
      const handle = getSaveFileHandle();

      // Assert
      expect(handle).toBe(mockFileHandle);
    });

    /**
     * Why this test matters (Issue 1 — 2026-02-26 user feedback):
     * The suggested filename should be timestamp-only, not scenario-based.
     */
    it('uses timestamp-only format in suggested filename', async () => {
      // Arrange
      const mockFileHandle = { kind: 'file', name: 'test.zip' };
      const mockPicker = vi.fn().mockResolvedValue(mockFileHandle);
      vi.stubGlobal('showSaveFilePicker', mockPicker);
      vi.stubGlobal('showDirectoryPicker', vi.fn());

      // Act
      vi.resetModules();
      const { selectSaveFile, resetExternalStorageState } =
        await import('./external-file-storage');
      resetExternalStorageState();

      await selectSaveFile();

      // Assert - suggested name should be timestamp-only
      expect(mockPicker).toHaveBeenCalledWith(
        expect.objectContaining({
          suggestedName: expect.stringMatching(
            /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}utc\.zip$/
          ),
        })
      );
    });
  });

  // ============================================================================
  // State Management Tests
  // ============================================================================

  describe('resetExternalStorageState', () => {
    it('clears stored handles', async () => {
      // Arrange
      const mockDirHandle = { kind: 'directory', name: 'folder' };
      const mockFileHandle = { kind: 'file', name: 'file.zip' };
      vi.stubGlobal(
        'showDirectoryPicker',
        vi.fn().mockResolvedValue(mockDirHandle)
      );
      vi.stubGlobal(
        'showSaveFilePicker',
        vi.fn().mockResolvedValue(mockFileHandle)
      );

      // Act
      vi.resetModules();
      const {
        selectReadFolder,
        selectSaveFile,
        getReadFolderHandle,
        getSaveFileHandle,
        resetExternalStorageState,
      } = await import('./external-file-storage');

      await selectReadFolder();
      await selectSaveFile();

      // Verify handles are stored
      expect(getReadFolderHandle()).toBe(mockDirHandle);
      expect(getSaveFileHandle()).toBe(mockFileHandle);

      // Act: reset
      resetExternalStorageState();

      // Assert: handles are cleared
      expect(getReadFolderHandle()).toBeNull();
      expect(getSaveFileHandle()).toBeNull();
    });
  });

  // ============================================================================
  // Error Handling Tests
  // ============================================================================

  describe('error handling', () => {
    it('selectReadFolder handles SecurityError gracefully', async () => {
      // Arrange
      const securityError = new DOMException('Security error', 'SecurityError');
      const mockPicker = vi.fn().mockRejectedValue(securityError);
      vi.stubGlobal('showDirectoryPicker', mockPicker);
      vi.stubGlobal('showSaveFilePicker', vi.fn());

      // Act
      vi.resetModules();
      const { selectReadFolder, resetExternalStorageState } =
        await import('./external-file-storage');
      resetExternalStorageState();

      const result = await selectReadFolder();

      // Assert
      expect(result).toEqual({
        success: false,
        reason: 'denied',
        error: expect.stringContaining('denied'),
      });
    });

    it('selectSaveFile handles unknown errors gracefully', async () => {
      // Arrange
      const unknownError = new Error('Something went wrong');
      const mockPicker = vi.fn().mockRejectedValue(unknownError);
      vi.stubGlobal('showSaveFilePicker', mockPicker);
      vi.stubGlobal('showDirectoryPicker', vi.fn());

      // Act
      vi.resetModules();
      const { selectSaveFile, resetExternalStorageState } =
        await import('./external-file-storage');
      resetExternalStorageState();

      const result = await selectSaveFile();

      // Assert
      expect(result).toEqual({
        success: false,
        reason: 'error',
        error: 'Something went wrong',
      });
    });
  });

  // ============================================================================
  // Generate Filename Tests
  // ============================================================================

  describe('generateSessionFilename', () => {
    /**
     * Why this test matters (Issue 1 — 2026-02-26 user feedback):
     * Filenames should start with the date, not a scenario prefix.
     * The timestamp-only format eliminates divergence between save-picker
     * and summary-download code paths.
     */
    it('generates timestamp-only filename without scenario prefix', async () => {
      // Arrange
      vi.stubGlobal('showDirectoryPicker', vi.fn());
      vi.stubGlobal('showSaveFilePicker', vi.fn());

      // Act
      vi.resetModules();
      const { generateSessionFilename } =
        await import('./external-file-storage');

      const testDate = new Date('2026-01-30T14:30:45Z');
      const result = generateSessionFilename(testDate);

      // Assert - just timestamp, no scenario prefix
      expect(result).toBe('2026-01-30_14-30-45utc.zip');
    });

    it('uses current date when no date is provided', async () => {
      vi.stubGlobal('showDirectoryPicker', vi.fn());
      vi.stubGlobal('showSaveFilePicker', vi.fn());

      vi.resetModules();
      const { generateSessionFilename } =
        await import('./external-file-storage');

      const result = generateSessionFilename();

      // Assert - should end with utc.zip and match timestamp pattern
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}utc\.zip$/);
    });

    /**
     * Why this test matters:
     * parseDateFromSessionFilename() in session-zip-naming.ts uses the regex
     * /(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})utc\.zip$/
     * The new timestamp-only format must still match that parser.
     */
    it('produces filenames compatible with parseDateFromSessionFilename regex', async () => {
      vi.stubGlobal('showDirectoryPicker', vi.fn());
      vi.stubGlobal('showSaveFilePicker', vi.fn());

      vi.resetModules();
      const { generateSessionFilename } =
        await import('./external-file-storage');

      const testDate = new Date('2026-02-26T09:15:30Z');
      const result = generateSessionFilename(testDate);

      // The regex used by session-zip-naming.ts
      const parserRegex =
        /(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})utc\.zip$/;
      expect(result).toMatch(parserRegex);
    });
  });

  describe('getSaveFileName', () => {
    /**
     * Why this test matters (Issue 1 — 2026-02-26 user feedback):
     * The save file handle's .name property is the single source of truth
     * for the ZIP filename. This avoids divergence between the picker's
     * suggested name and what the summary/share code uses.
     */
    it('returns handle.name when save file handle exists', async () => {
      vi.stubGlobal('showDirectoryPicker', vi.fn());
      vi.stubGlobal(
        'showSaveFilePicker',
        vi.fn().mockResolvedValue({
          name: 'my-custom-name.zip',
          createWritable: vi.fn(),
        })
      );

      vi.resetModules();
      const { selectSaveFile, getSaveFileName } =
        await import('./external-file-storage');

      await selectSaveFile();
      expect(getSaveFileName()).toBe('my-custom-name.zip');
    });

    it('returns null when no save file handle exists', async () => {
      vi.stubGlobal('showDirectoryPicker', vi.fn());
      vi.stubGlobal('showSaveFilePicker', vi.fn());

      vi.resetModules();
      const { getSaveFileName, resetExternalStorageState } =
        await import('./external-file-storage');

      resetExternalStorageState();
      expect(getSaveFileName()).toBeNull();
    });
  });

  // ============================================================================
  // Soft Reset Tests (Issue 4 — retain read permission on new recording)
  // ============================================================================

  describe('resetForNewRecording', () => {
    // Why this test matters: When the user starts a new recording, the save file
    // handle must be cleared (each session gets its own ZIP), but the read folder
    // handle should be preserved so they don't have to re-select the folder.
    it('clears save file handle but preserves read folder handle', async () => {
      // Arrange
      const mockDirHandle = { kind: 'directory', name: 'folder' };
      const mockFileHandle = { kind: 'file', name: 'file.zip' };
      vi.stubGlobal(
        'showDirectoryPicker',
        vi.fn().mockResolvedValue(mockDirHandle)
      );
      vi.stubGlobal(
        'showSaveFilePicker',
        vi.fn().mockResolvedValue(mockFileHandle)
      );

      vi.resetModules();
      const {
        selectReadFolder,
        selectSaveFile,
        getReadFolderHandle,
        getSaveFileHandle,
        resetForNewRecording,
      } = await import('./external-file-storage');

      await selectReadFolder();
      await selectSaveFile();

      // Verify both handles are stored
      expect(getReadFolderHandle()).toBe(mockDirHandle);
      expect(getSaveFileHandle()).toBe(mockFileHandle);

      // Act
      resetForNewRecording();

      // Assert: save file handle cleared, read folder handle preserved
      expect(getSaveFileHandle()).toBeNull();
      expect(getReadFolderHandle()).toBe(mockDirHandle);
    });

    // Why this test matters: resetForNewRecording should be safe to call even
    // when no handles exist (e.g., first launch, or storage was never set up)
    it('is safe to call with no handles set', async () => {
      vi.stubGlobal('showDirectoryPicker', vi.fn());
      vi.stubGlobal('showSaveFilePicker', vi.fn());

      vi.resetModules();
      const { resetForNewRecording, getReadFolderHandle, getSaveFileHandle } =
        await import('./external-file-storage');

      // Act — should not throw
      resetForNewRecording();

      // Assert: both still null
      expect(getReadFolderHandle()).toBeNull();
      expect(getSaveFileHandle()).toBeNull();
    });
  });

  describe('hasReadFolderPermission', () => {
    // Why this test matters: After a soft reset, we need to check if the
    // preserved read folder handle still has 'granted' permission without
    // re-prompting the user.
    it('returns true when readFolderHandle has granted permission', async () => {
      const mockDirHandle = {
        kind: 'directory',
        name: 'folder',
        queryPermission: vi.fn().mockResolvedValue('granted'),
      };
      vi.stubGlobal(
        'showDirectoryPicker',
        vi.fn().mockResolvedValue(mockDirHandle)
      );
      vi.stubGlobal('showSaveFilePicker', vi.fn());

      vi.resetModules();
      const { selectReadFolder, hasReadFolderPermission } =
        await import('./external-file-storage');

      await selectReadFolder();

      // Act
      const result = await hasReadFolderPermission();

      // Assert
      expect(result).toBe(true);
      expect(mockDirHandle.queryPermission).toHaveBeenCalledWith({
        mode: 'read',
      });
    });

    // Why this test matters: If the permission was revoked or the handle is
    // stale, we should not auto-populate and the user needs to re-select.
    it('returns false when readFolderHandle has prompt permission', async () => {
      const mockDirHandle = {
        kind: 'directory',
        name: 'folder',
        queryPermission: vi.fn().mockResolvedValue('prompt'),
      };
      vi.stubGlobal(
        'showDirectoryPicker',
        vi.fn().mockResolvedValue(mockDirHandle)
      );
      vi.stubGlobal('showSaveFilePicker', vi.fn());

      vi.resetModules();
      const { selectReadFolder, hasReadFolderPermission } =
        await import('./external-file-storage');

      await selectReadFolder();

      const result = await hasReadFolderPermission();
      expect(result).toBe(false);
    });

    // Why this test matters: If no folder was ever selected, permission check
    // should gracefully return false rather than throwing.
    it('returns false when no read folder handle exists', async () => {
      vi.stubGlobal('showDirectoryPicker', vi.fn());
      vi.stubGlobal('showSaveFilePicker', vi.fn());

      vi.resetModules();
      const { hasReadFolderPermission } =
        await import('./external-file-storage');

      const result = await hasReadFolderPermission();
      expect(result).toBe(false);
    });

    // Why this test matters: queryPermission may throw if the handle is invalid;
    // we must catch this and return false instead of crashing.
    it('returns false when queryPermission throws', async () => {
      const mockDirHandle = {
        kind: 'directory',
        name: 'folder',
        queryPermission: vi.fn().mockRejectedValue(new Error('handle invalid')),
      };
      vi.stubGlobal(
        'showDirectoryPicker',
        vi.fn().mockResolvedValue(mockDirHandle)
      );
      vi.stubGlobal('showSaveFilePicker', vi.fn());

      vi.resetModules();
      const { selectReadFolder, hasReadFolderPermission } =
        await import('./external-file-storage');

      await selectReadFolder();

      const result = await hasReadFolderPermission();
      expect(result).toBe(false);
    });
  });
});
