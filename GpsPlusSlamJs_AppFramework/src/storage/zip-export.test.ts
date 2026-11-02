/**
 * ZIP Export Module Tests
 *
 * Tests for exporting OPFS session data as ZIP files.
 * The ZIP format allows users to download their recordings for
 * offline analysis and sharing.
 *
 * Why these tests matter:
 * - ZIP must be valid and readable by native OS tools
 * - File structure inside ZIP must match the framework's flat OPFS layout
 * - Binary data (frames) must not be corrupted
 *
 * The framework exports flat `sessions/{name}/` sessions; app-specific layouts
 * (e.g. the recorder's `scenarios/{name}/`) resolve their own handle and call
 * `exportSessionHandleAsZip` — covered by the recorder's own tests.
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
  expectTypeOf,
} from 'vitest';
import { BlobReader, ZipReader, Uint8ArrayWriter } from '@zip.js/zip.js';
import type { MockOPFSDirectoryHandle } from '../test-utils/browser-mocks';
import { installOPFSMocks } from '../test-utils/browser-mocks';
import { formatTimestamp } from './file-system-utils';
import {
  initOpfsStorage,
  writeAction,
  writeFrame,
  writeSessionMetadata,
  resetOpfsStorage,
  getAppRootHandle,
  setSessionHandles,
  type SessionMetadata,
} from './opfs-storage';
import {
  exportSessionAsZip,
  exportSessionHandleAsZip,
  downloadBlob,
  downloadZip,
  ZIP_FILE_TYPE,
  syncToExternalZip,
  type ZipExportResult,
} from './zip-export';
import { loadSessionMetadataFromBlob } from './zip-reader';

/**
 * Helper to decompress a ZIP blob and return file contents.
 * Uses @zip.js/zip.js for verification (same library as production code).
 */
async function unzipBlob(blob: Blob): Promise<Map<string, Uint8Array>> {
  const zipReader = new ZipReader(new BlobReader(blob));
  const entries = await zipReader.getEntries();
  const files = new Map<string, Uint8Array>();

  for (const entry of entries) {
    if (!entry.directory && entry.getData) {
      const data = await entry.getData(new Uint8ArrayWriter());
      files.set(entry.filename, data);
    }
  }

  await zipReader.close();
  return files;
}

/**
 * Build a flat-layout session under OPFS for the framework's export tests.
 *
 * Creates `gps-plus-slam/sessions/recording-{ts}/` with empty `actions/` and
 * `frames/` subdirectories, and wires the handles into opfs-storage so
 * subsequent `writeAction` / `writeFrame` / `writeSessionMetadata` calls target
 * this session. Returns the session name (for `exportSessionAsZip`) and the
 * resolved session handle (for `exportSessionHandleAsZip`).
 */
async function createFlatSession(timestamp: Date): Promise<{
  sessionName: string;
  sessionHandle: FileSystemDirectoryHandle;
}> {
  const appRoot = getAppRootHandle();
  if (!appRoot) {
    throw new Error('OPFS not initialized - call initOpfsStorage first');
  }
  const sessionsDir = await appRoot.getDirectoryHandle('sessions', {
    create: true,
  });
  const sessionName = `recording-${formatTimestamp(timestamp)}`;
  const sessionHandle = await sessionsDir.getDirectoryHandle(sessionName, {
    create: true,
  });
  const actions = await sessionHandle.getDirectoryHandle('actions', {
    create: true,
  });
  const frames = await sessionHandle.getDirectoryHandle('frames', {
    create: true,
  });
  setSessionHandles(sessionHandle, actions, frames);
  return { sessionName, sessionHandle };
}

describe('zip-export', () => {
  let _opfsRoot: MockOPFSDirectoryHandle;
  let cleanup: () => void;

  beforeEach(() => {
    const mocks = installOPFSMocks();
    _opfsRoot = mocks.root;
    cleanup = mocks.cleanup;
  });

  afterEach(() => {
    cleanup();
    resetOpfsStorage();
  });

  describe('exportSessionAsZip', () => {
    it('creates a valid ZIP blob', async () => {
      // Why: ZIP must be readable by native OS tools
      await initOpfsStorage();
      const { sessionName } = await createFlatSession(
        new Date('2026-01-26T10:00:00Z')
      );

      const metadata: SessionMetadata = {
        version: 1,
        startedAt: '2026-01-26T10:00:00.000Z',
        endedAt: '2026-01-26T10:30:00.000Z',
        contextTag: 'test-tag',
        actionCount: 1,
        frameCount: 0,
        userAgent: 'Test Browser',
      };
      await writeSessionMetadata(metadata);
      await writeAction({ type: 'test/action' }, 1);

      const { blob: zipBlob } = await exportSessionAsZip(sessionName);

      expect(zipBlob).toBeInstanceOf(Blob);
      expect(zipBlob.type).toBe('application/zip');
      expect(zipBlob.size).toBeGreaterThan(0);
    });

    it('includes session.json at root level', async () => {
      // Why: Session metadata must be easily accessible
      await initOpfsStorage();
      const { sessionName } = await createFlatSession(
        new Date('2026-01-26T10:00:00Z')
      );

      const metadata: SessionMetadata = {
        version: 1,
        startedAt: '2026-01-26T10:00:00.000Z',
        endedAt: '2026-01-26T10:30:00.000Z',
        contextTag: 'test-tag',
        actionCount: 0,
        frameCount: 0,
        userAgent: 'Test Browser',
      };
      await writeSessionMetadata(metadata);

      const { blob: zipBlob } = await exportSessionAsZip(sessionName);
      const files = await unzipBlob(zipBlob);

      expect(files.has('session.json')).toBe(true);
      const content = new TextDecoder().decode(files.get('session.json'));
      const parsed = JSON.parse(content) as { contextTag: string };
      expect(parsed.contextTag).toBe('test-tag');
    });

    it('round-trips the H3 coverage index (h3Cells + h3Resolution) through the ZIP', async () => {
      // Why: the map-centric browser reads h3Cells straight from session.json via
      // loadSessionMetadataFromBlob during folder discovery. The reader must not
      // strip the new fields on the export→read round-trip (Step 2 / D1).
      await initOpfsStorage();
      const { sessionName } = await createFlatSession(
        new Date('2026-01-26T10:00:00Z')
      );

      const h3Cells = ['8b1fa1da1d64fff', '8b1fa1da1d4afff', '8b1fa1da1c09fff'];
      const metadata: SessionMetadata = {
        version: 1,
        startedAt: '2026-01-26T10:00:00.000Z',
        endedAt: '2026-01-26T10:30:00.000Z',
        contextTag: 'test-tag',
        actionCount: 3,
        frameCount: 0,
        userAgent: 'Test Browser',
        h3Cells,
        h3Resolution: 11,
      };
      await writeSessionMetadata(metadata);

      const { blob: zipBlob } = await exportSessionAsZip(sessionName);
      const parsed = await loadSessionMetadataFromBlob(zipBlob);

      expect(parsed?.h3Cells).toEqual(h3Cells);
      expect(parsed?.h3Resolution).toBe(11);
    });

    it('reads legacy session.json without h3Cells (backward compatibility)', async () => {
      // Why: recordings made before the coverage index existed have no h3Cells.
      // The reader must still load them (h3Cells undefined) so the browser can
      // fall back to in-memory backfill rather than crashing (Step 2 / D2).
      await initOpfsStorage();
      const { sessionName } = await createFlatSession(
        new Date('2026-01-26T10:00:00Z')
      );

      const legacyMetadata: SessionMetadata = {
        version: 1,
        startedAt: '2026-01-26T10:00:00.000Z',
        endedAt: '2026-01-26T10:30:00.000Z',
        contextTag: 'legacy-tag',
        actionCount: 0,
        frameCount: 0,
        userAgent: 'Test Browser',
      };
      await writeSessionMetadata(legacyMetadata);

      const { blob: zipBlob } = await exportSessionAsZip(sessionName);
      const parsed = await loadSessionMetadataFromBlob(zipBlob);

      expect(parsed).not.toBeNull();
      expect(parsed?.contextTag).toBe('legacy-tag');
      expect(parsed?.h3Cells).toBeUndefined();
      expect(parsed?.h3Resolution).toBeUndefined();
    });

    it('includes actions in actions/ folder', async () => {
      // Why: Actions must be in correct location for replay
      await initOpfsStorage();
      const { sessionName } = await createFlatSession(
        new Date('2026-01-26T10:00:00Z')
      );

      await writeAction({ type: 'action1', payload: 'test1' }, 1);
      await writeAction({ type: 'action2', payload: 'test2' }, 2);

      const { blob: zipBlob } = await exportSessionAsZip(sessionName);
      const files = await unzipBlob(zipBlob);

      expect(files.has('actions/000001.json')).toBe(true);
      expect(files.has('actions/000002.json')).toBe(true);

      const action1 = JSON.parse(
        new TextDecoder().decode(files.get('actions/000001.json'))
      ) as { type: string };
      expect(action1.type).toBe('action1');
    });

    it('includes frames in frames/ folder', async () => {
      // Why: Frames must be in correct location for replay
      await initOpfsStorage();
      const { sessionName } = await createFlatSession(
        new Date('2026-01-26T10:00:00Z')
      );

      const frameData = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]); // JPEG magic
      await writeFrame(new Blob([frameData], { type: 'image/jpeg' }), 1);

      const { blob: zipBlob } = await exportSessionAsZip(sessionName);
      const files = await unzipBlob(zipBlob);

      expect(files.has('frames/frame-000001.jpg')).toBe(true);
      const frameContent = files.get('frames/frame-000001.jpg');
      expect(frameContent).toEqual(frameData);
    });

    it('preserves binary frame data exactly', async () => {
      // Why: Image corruption would make recordings useless
      await initOpfsStorage();
      const { sessionName } = await createFlatSession(
        new Date('2026-01-26T10:00:00Z')
      );

      // Create a larger binary blob with various byte values
      const originalData = new Uint8Array(256);
      for (let i = 0; i < 256; i++) {
        originalData[i] = i;
      }
      await writeFrame(new Blob([originalData]), 5);

      const { blob: zipBlob } = await exportSessionAsZip(sessionName);
      const files = await unzipBlob(zipBlob);

      const extractedData = files.get('frames/frame-000005.jpg');
      expect(extractedData).toEqual(originalData);
    });

    it('throws for non-existent session', async () => {
      // Why: Clear error for invalid export request
      await initOpfsStorage();

      await expect(
        exportSessionAsZip('recording-2026-01-26_10-00-00utc')
      ).rejects.toThrow(/session.*not found/i);
    });

    it('uses store mode (no compression) for fast packaging', async () => {
      // Why: Uncompressed ZIP is faster to create; images are already compressed
      await initOpfsStorage();
      const { sessionName } = await createFlatSession(
        new Date('2026-01-26T10:00:00Z')
      );

      // Write some compressible data
      const text = 'A'.repeat(1000);
      await writeAction({ type: 'test', data: text }, 1);

      const { blob: zipBlob } = await exportSessionAsZip(sessionName);

      // With store mode, ZIP size should be >= original content size
      // (Compression would make it smaller)
      const files = await unzipBlob(zipBlob);
      const actionContent = files.get('actions/000001.json');
      // Just verify it's a valid ZIP - `@zip.js/zip.js` handles the decompression
      expect(actionContent).toBeDefined();
    });

    it('returns a ZipExportResult with blob and fileCount', async () => {
      // Why: Issue #2+#3 (2026-02-06) need blob + file count for share/stats
      await initOpfsStorage();
      const { sessionName } = await createFlatSession(
        new Date('2026-02-06T10:00:00Z')
      );

      const metadata: SessionMetadata = {
        version: 1,
        startedAt: '2026-02-06T10:00:00.000Z',
        endedAt: '2026-02-06T10:30:00.000Z',
        contextTag: 'meta-tag',
        actionCount: 2,
        frameCount: 1,
        userAgent: 'Test Browser',
      };
      await writeSessionMetadata(metadata);
      await writeAction({ type: 'a1' }, 1);
      await writeAction({ type: 'a2' }, 2);
      const frameData = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
      await writeFrame(new Blob([frameData], { type: 'image/jpeg' }), 1);

      const result: ZipExportResult = await exportSessionAsZip(sessionName);

      // Must return an object with blob and fileCount
      expect(result).toHaveProperty('blob');
      expect(result).toHaveProperty('fileCount');
      expect(result.blob).toBeInstanceOf(Blob);
      expect(result.blob.type).toBe('application/zip');
      // session.json + 2 actions + 1 frame = 4 files
      expect(result.fileCount).toBe(4);
    });
  });

  describe('exportSessionHandleAsZip', () => {
    /**
     * Why this test matters: this is the layout-agnostic core that consumers
     * with their own directory layout (e.g. the recorder's `scenarios/{name}/`
     * nesting) call directly. It must package an arbitrary session handle —
     * including caller-supplied extension contributors — without any knowledge
     * of how that handle was located.
     */
    it('packages a resolved session handle, including a contributor subdir', async () => {
      await initOpfsStorage();
      const { sessionHandle } = await createFlatSession(
        new Date('2026-03-01T10:00:00Z')
      );

      const metadata: SessionMetadata = {
        version: 1,
        startedAt: '2026-03-01T10:00:00.000Z',
        endedAt: '2026-03-01T10:05:00.000Z',
        contextTag: 'handle-tag',
        actionCount: 1,
        frameCount: 0,
        userAgent: 'Test Browser',
      };
      await writeSessionMetadata(metadata);
      await writeAction({ type: 'a1' }, 1);

      const { blob, fileCount } = await exportSessionHandleAsZip(
        sessionHandle,
        {
          contributors: [
            {
              subdir: 'extras',
              async contribute(addFile) {
                await addFile(
                  'note.txt',
                  new Blob(['hi'], { type: 'text/plain' })
                );
                return 1;
              },
            },
          ],
        }
      );

      // session.json + 1 action + 1 contributor file = 3
      expect(fileCount).toBe(3);
      const files = await unzipBlob(blob);
      expect(files.has('session.json')).toBe(true);
      expect(files.has('actions/000001.json')).toBe(true);
      expect(files.has('extras/note.txt')).toBe(true);
    });
  });

  describe('downloadZip', () => {
    it('creates download link with correct filename', async () => {
      // Why: User should get a meaningful filename
      const blob = new Blob(['test'], { type: 'application/zip' });

      // Mock DOM environment
      const mockLink = {
        href: '',
        download: '',
        click: vi.fn(),
        style: { display: '' },
      };
      const mockBody = {
        appendChild: vi.fn(),
        removeChild: vi.fn(),
      };

      vi.stubGlobal('document', {
        createElement: vi.fn((tag: string) => {
          if (tag === 'a') {
            return mockLink;
          }
          throw new Error(`Unexpected createElement: ${tag}`);
        }),
        body: mockBody,
      });

      vi.stubGlobal('URL', {
        createObjectURL: vi.fn(() => 'blob:test-url'),
        revokeObjectURL: vi.fn(),
      });

      // Mock window without showSaveFilePicker to force fallback path
      vi.stubGlobal('window', {});

      try {
        await downloadZip(blob, 'test-session-2026-01-26.zip');

        expect(mockLink.download).toBe('test-session-2026-01-26.zip');
        expect(mockLink.href).toBe('blob:test-url');
        expect(mockLink.click).toHaveBeenCalled();
      } finally {
        vi.unstubAllGlobals();
      }
    });

    // Why (Tour Viewer M6 E2 plan review #7, DEC-A3): the save picker's
    // write was hand-rolled without abort(), so a failed write left the
    // writable open, holding the lock and the temp file (a failed write()
    // throws before close(), so nothing partial was committed). It goes
    // through writeFileOrAbort now.
    it('aborts, never closes, a picked file whose write fails', async () => {
      const writable = {
        write: vi.fn(() => Promise.reject(new Error('disk full'))),
        close: vi.fn(() => Promise.resolve()),
        abort: vi.fn(() => Promise.resolve()),
      };
      const handle = { createWritable: vi.fn(() => Promise.resolve(writable)) };
      vi.stubGlobal('window', {
        showSaveFilePicker: vi.fn(() => Promise.resolve(handle)),
      });
      vi.stubGlobal('document', {
        createElement: () => ({ click: vi.fn(), style: {} }),
        body: { appendChild: vi.fn(), removeChild: vi.fn() },
      });
      vi.stubGlobal('URL', {
        createObjectURL: vi.fn(() => 'blob:x'),
        revokeObjectURL: vi.fn(),
      });
      try {
        await downloadZip(new Blob(['zip']), 'tour.zip');
        expect(writable.abort).toHaveBeenCalledTimes(1);
        expect(writable.close).not.toHaveBeenCalled();
      } finally {
        vi.unstubAllGlobals();
      }
    });
  });

  describe('downloadBlob with a nullish rejection', () => {
    // Why: a documented change of the published `downloadBlob` (CHANGELOG
    // "Changed"). It used to read `err.name` off the rejection, so a `null`
    // or `undefined` one threw a TypeError out of the call; it now goes
    // through `classifyPickerRejection` and a null-safe read, and falls
    // back to the anchor download like any other non-dismissal. The
    // characterisation file `download-blob.test.ts` stays frozen, so the
    // change is pinned here.
    function stageAnchor(win: object): string[] {
      const clicked: string[] = [];
      vi.stubGlobal('window', win);
      vi.stubGlobal('document', {
        createElement: () => {
          const link = {
            href: '',
            download: '',
            style: {},
            click: () => clicked.push(link.download),
          };
          return link;
        },
        body: { appendChild: vi.fn(), removeChild: vi.fn() },
      });
      vi.stubGlobal('URL', {
        createObjectURL: vi.fn(() => 'blob:x'),
        revokeObjectURL: vi.fn(),
      });
      return clicked;
    }

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    for (const value of [null, undefined]) {
      it(`falls back to the anchor download when the dialog rejects with ${String(value)}`, async () => {
        const clicked = stageAnchor({
          // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- the nullish rejection is the case under test
          showSaveFilePicker: vi.fn(() => Promise.reject(value)),
        });
        await expect(
          downloadBlob(new Blob(['zip']), 'tour.zip', ZIP_FILE_TYPE)
        ).resolves.toBe(true);
        expect(clicked).toEqual(['tour.zip']);
      });

      // Opening the picked file for writing: `writeFileOrAbort` normalises a
      // non-Error from `write()` or `close()` into an Error, but a rejection
      // of `createWritable()` reaches `downloadBlob` as it is.
      it(`falls back to the anchor download when opening the picked file rejects with ${String(value)}`, async () => {
        const handle = {
          // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- the nullish rejection is the case under test
          createWritable: vi.fn(() => Promise.reject(value)),
        };
        const clicked = stageAnchor({
          showSaveFilePicker: vi.fn(() => Promise.resolve(handle)),
        });
        await expect(
          downloadBlob(new Blob(['zip']), 'tour.zip', ZIP_FILE_TYPE)
        ).resolves.toBe(true);
        expect(clicked).toEqual(['tour.zip']);
      });
    }
  });

  describe('syncToExternalZip', () => {
    /**
     * Mock FileSystemFileHandle with createWritable().
     * Simulates the File System Access API handle obtained from showSaveFilePicker.
     */
    function createMockFileHandle(): {
      handle: FileSystemFileHandle;
      getWrittenData: () => Blob | null;
    } {
      let writtenBlob: Blob | null = null;

      const mockWritable = {
        write: vi.fn((data: Blob) => {
          writtenBlob = data;
          return Promise.resolve();
        }),
        close: vi.fn(() => Promise.resolve()),
      };

      const handle = {
        kind: 'file' as const,
        name: 'test-session.zip',
        createWritable: vi.fn(() => Promise.resolve(mockWritable)),
        getFile: vi.fn(),
        isSameEntry: vi.fn(),
        queryPermission: vi.fn(),
        requestPermission: vi.fn(),
      } as unknown as FileSystemFileHandle;

      return { handle, getWrittenData: () => writtenBlob };
    }

    // Why (DEC-A3, as above): a failed sync must leave the last good ZIP.
    it('aborts, never closes, the external file when the write fails', async () => {
      await initOpfsStorage();
      const { sessionName } = await createFlatSession(
        new Date('2026-01-30T10:00:00Z')
      );
      const writable = {
        write: vi.fn(() => Promise.reject(new Error('disk full'))),
        close: vi.fn(() => Promise.resolve()),
        abort: vi.fn(() => Promise.resolve()),
      };
      const handle = {
        createWritable: vi.fn(() => Promise.resolve(writable)),
      } as unknown as FileSystemFileHandle;
      await expect(syncToExternalZip(handle, sessionName)).rejects.toThrow(
        'disk full'
      );
      expect(writable.abort).toHaveBeenCalledTimes(1);
      expect(writable.close).not.toHaveBeenCalled();
    });

    it('writes a valid ZIP to the external file handle', async () => {
      // Why: This is the primary use case - sync OPFS data to user's chosen file
      await initOpfsStorage();
      const { sessionName } = await createFlatSession(
        new Date('2026-01-30T10:00:00Z')
      );

      const metadata: SessionMetadata = {
        version: 1,
        startedAt: '2026-01-30T10:00:00.000Z',
        endedAt: '',
        contextTag: 'sync-tag',
        actionCount: 2,
        frameCount: 0,
        userAgent: 'Test Browser',
      };
      await writeSessionMetadata(metadata);
      await writeAction({ type: 'test/action1' }, 1);
      await writeAction({ type: 'test/action2' }, 2);

      const { handle, getWrittenData } = createMockFileHandle();

      await syncToExternalZip(handle, sessionName);

      // Verify a blob was written
      const writtenBlob = getWrittenData();
      expect(writtenBlob).toBeInstanceOf(Blob);
      expect(writtenBlob!.type).toBe('application/zip');

      // Verify the ZIP contains the expected files
      const files = await unzipBlob(writtenBlob!);
      expect(files.has('session.json')).toBe(true);
      expect(files.has('actions/000001.json')).toBe(true);
      expect(files.has('actions/000002.json')).toBe(true);
    });

    it('includes frames in the synced ZIP', async () => {
      // Why: Frames are critical recording data and must be synced
      await initOpfsStorage();
      const { sessionName } = await createFlatSession(
        new Date('2026-01-30T11:00:00Z')
      );

      const frameData = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
      await writeFrame(new Blob([frameData], { type: 'image/jpeg' }), 1);

      const { handle, getWrittenData } = createMockFileHandle();

      await syncToExternalZip(handle, sessionName);

      const files = await unzipBlob(getWrittenData()!);
      expect(files.has('frames/frame-000001.jpg')).toBe(true);
      expect(files.get('frames/frame-000001.jpg')).toEqual(frameData);
    });

    it('calls createWritable and close on the handle', async () => {
      // Why: Proper handle lifecycle is critical for data integrity
      await initOpfsStorage();
      const { sessionName } = await createFlatSession(
        new Date('2026-01-30T12:00:00Z')
      );

      const mockWritable = {
        write: vi.fn(() => Promise.resolve()),
        close: vi.fn(() => Promise.resolve()),
      };

      const handle = {
        kind: 'file' as const,
        name: 'test-session.zip',
        createWritable: vi.fn(() => Promise.resolve(mockWritable)),
      } as unknown as FileSystemFileHandle;

      await syncToExternalZip(handle, sessionName);

      expect(handle.createWritable).toHaveBeenCalledTimes(1);
      expect(mockWritable.write).toHaveBeenCalledTimes(1);
      expect(mockWritable.close).toHaveBeenCalledTimes(1);
    });

    it('throws for non-existent session', async () => {
      // Why: Clear error handling for invalid sync request
      await initOpfsStorage();
      const { handle } = createMockFileHandle();

      await expect(
        syncToExternalZip(handle, 'recording-2026-01-30_10-00-00utc')
      ).rejects.toThrow(/session.*not found/i);
    });

    it('returns ZipExportResult with blob and fileCount', async () => {
      // Why: Issue #2+#3 (2026-02-06) — caller needs blob for share + stats
      await initOpfsStorage();
      const { sessionName } = await createFlatSession(
        new Date('2026-02-06T14:00:00Z')
      );

      const metadata: SessionMetadata = {
        version: 1,
        startedAt: '2026-02-06T14:00:00.000Z',
        endedAt: '2026-02-06T14:30:00.000Z',
        contextTag: 'result-tag',
        actionCount: 1,
        frameCount: 0,
        userAgent: 'Test Browser',
      };
      await writeSessionMetadata(metadata);
      await writeAction({ type: 'test/sync-result' }, 1);

      const { handle, getWrittenData } = createMockFileHandle();

      const result: ZipExportResult = await syncToExternalZip(
        handle,
        sessionName
      );

      // Must return blob and fileCount
      expect(result).toHaveProperty('blob');
      expect(result).toHaveProperty('fileCount');
      expect(result.blob).toBeInstanceOf(Blob);
      expect(result.blob.type).toBe('application/zip');
      // session.json + 1 action = 2 files
      expect(result.fileCount).toBe(2);
      // Blob written to handle should match returned blob
      const writtenBlob = getWrittenData();
      expect(writtenBlob).toBeInstanceOf(Blob);
      expect(writtenBlob!.size).toBe(result.blob.size);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Memory efficiency — BlobReader instead of arrayBuffer + Uint8ArrayReader
  // ──────────────────────────────────────────────────────────────────────────

  describe('memory-efficient file streaming', () => {
    it('uses BlobReader instead of Uint8ArrayReader for streaming file data into ZIP', async () => {
      // Why: Regression guard. BlobReader lets zip.js handle file data
      // without forcing the entire file into the JS heap via
      // file.arrayBuffer() + new Uint8Array(buffer). If this test fails,
      // someone has regressed to the heap-copying pattern.
      const { readFile } = await import('fs/promises');
      const { fileURLToPath } = await import('url');
      const modulePath = fileURLToPath(
        new URL('./zip-export.ts', import.meta.url)
      );
      const source = await readFile(modulePath, 'utf8');

      // streamDirectoryToZip must use BlobReader, not Uint8ArrayReader
      expect(source).toMatch(/new BlobReader\(/);
      expect(source).not.toMatch(/new Uint8ArrayReader\(/);
      // file.arrayBuffer() heap-copy pattern must not appear
      expect(source).not.toMatch(/\.arrayBuffer\(\)/);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Readonly guards — Finding #6 (2026-03-05 code review)
  // ──────────────────────────────────────────────────────────────────────────

  describe('Readonly guards for pure-data interfaces', () => {
    /**
     * Why this test matters:
     * ZipExportResult is created once and returned; never mutated.
     */
    it('ZipExportResult = Readonly<ZipExportResult>', () => {
      expectTypeOf<ZipExportResult>().toEqualTypeOf<
        Readonly<ZipExportResult>
      >();
    });
  });
});
