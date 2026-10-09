/**
 * OPFS Storage Module Tests
 *
 * Tests for the Origin Private File System (OPFS) storage backend.
 * This module replaces showDirectoryPicker with OPFS for cross-platform
 * compatibility (Android Chrome, iOS Safari, Desktop).
 *
 * Why these tests matter:
 * - OPFS is the foundation of the storage strategy
 * - Must verify atomic writes work correctly
 * - Must verify flat session layout (no scenario hierarchy)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { MockOPFSDirectoryHandle } from '../test-utils/browser-mocks';
import { installOPFSMocks } from '../test-utils/browser-mocks';
import {
  initOpfsStorage,
  createSession,
  createSessionInDirectory,
  writeAction,
  writeFrame,
  listSessions,
  writeSessionMetadata,
  getSessionHandle,
  resetOpfsStorage,
  type SessionMetadata,
} from './opfs-storage';

describe('opfs-storage', () => {
  let opfsRoot: MockOPFSDirectoryHandle;
  let cleanup: () => void;

  beforeEach(() => {
    const mocks = installOPFSMocks();
    opfsRoot = mocks.root;
    cleanup = mocks.cleanup;
  });

  afterEach(() => {
    cleanup();
    resetOpfsStorage();
  });

  describe('initOpfsStorage', () => {
    it('creates gps-plus-slam/sessions/ directory structure in OPFS root', async () => {
      // Why: flat layout uses sessions/ directly under gps-plus-slam/
      // (scenarios/ is recorder-only, handled by ScenarioWrappingStorageBackend)
      await initOpfsStorage();

      const gpsPlusSlamDir = await opfsRoot.getDirectoryHandle('gps-plus-slam');
      expect(gpsPlusSlamDir).toBeDefined();
      expect(gpsPlusSlamDir.name).toBe('gps-plus-slam');

      const sessionsDir = await (
        gpsPlusSlamDir as unknown as MockOPFSDirectoryHandle
      ).getDirectoryHandle('sessions');
      expect(sessionsDir).toBeDefined();
      expect(sessionsDir.name).toBe('sessions');
    });

    it('is idempotent - calling twice does not error', async () => {
      // Why: App may call init multiple times (e.g., on page refresh)
      await initOpfsStorage();
      await expect(initOpfsStorage()).resolves.not.toThrow();
    });

    it('throws when OPFS is not supported', async () => {
      // Why: Must give clear error on unsupported browsers
      cleanup();
      const existingNavigator =
        typeof navigator !== 'undefined' ? navigator : {};
      vi.stubGlobal('navigator', {
        ...existingNavigator,
        storage: undefined,
      });

      await expect(initOpfsStorage()).rejects.toThrow(/OPFS.*not supported/i);

      vi.unstubAllGlobals();
    });
  });

  describe('createSession', () => {
    beforeEach(async () => {
      await initOpfsStorage();
    });

    it('creates a flat session folder under sessions/', async () => {
      // Why: framework uses flat sessions/{timestamp}/ layout; scenarios
      // are layered on by the recorder's wrapping backend
      const timestamp = new Date('2026-01-26T10:30:00Z');
      const result = await createSession(timestamp);

      expect(result.sessionName).toMatch(/^recording-2026-01-26_10-30-00utc$/);
    });

    it('creates session folder with actions/ and images/ subdirectories', async () => {
      // Why: Session must have actions/ and images/ subdirectories for write ops
      const timestamp = new Date('2026-01-26T10:30:00Z');
      await createSession(timestamp);

      const sessionHandle = getSessionHandle();
      expect(sessionHandle).not.toBeNull();

      const actionsDir = await sessionHandle!.getDirectoryHandle('actions');
      expect(actionsDir).toBeDefined();

      const framesDir = await sessionHandle!.getDirectoryHandle('images'); // renamed from frames/ (Q5)
      expect(framesDir).toBeDefined();
    });

    it('creates multiple sessions side by side', async () => {
      // Why: flat layout allows multiple sessions without scenario grouping
      const timestamp1 = new Date('2026-01-26T10:00:00Z');
      const timestamp2 = new Date('2026-01-26T11:00:00Z');

      const result1 = await createSession(timestamp1);
      const result2 = await createSession(timestamp2);

      expect(result1.sessionName).toMatch(/^recording-2026-01-26_10-00-00utc$/);
      expect(result2.sessionName).toMatch(/^recording-2026-01-26_11-00-00utc$/);
    });

    it('stores contextTag in result when provided', async () => {
      // Why: contextTag is passed through so callers can use it for metadata
      const timestamp = new Date('2026-01-26T10:30:00Z');
      const result = await createSession(timestamp, 'my-tag');

      expect(result.sessionName).toMatch(/^recording-2026-01-26_10-30-00utc$/);
    });

    it('disambiguates two sessions started in the same UTC second', async () => {
      // Why: `formatTimestamp` resolves to whole UTC seconds, so two recordings
      // started within the same second would otherwise resolve to the SAME
      // `recording-<ts>/` directory — `getDirectoryHandle(..., {create:true})`
      // returns the existing handle, silently MIXING both recordings'
      // session.json/actions/frames. A stop-then-immediate-restart within one
      // second is the realistic trigger. The second session must own a
      // distinct directory, while the first keeps the bare timestamp name.
      const result1 = await createSession(new Date('2026-01-26T10:30:00Z'));
      const handle1 = getSessionHandle();
      const result2 = await createSession(new Date('2026-01-26T10:30:00Z'));
      const handle2 = getSessionHandle();

      expect(result1.sessionName).toBe('recording-2026-01-26_10-30-00utc');
      expect(result2.sessionName).not.toBe(result1.sessionName);
      expect(handle2).not.toBe(handle1);
      expect(handle2).not.toBeNull();
    });

    it('picks a suffixed name when a FILE occupies the timestamp name (PR #158 review)', async () => {
      // Why: the collision probe (`sessionDirExists`) used to treat EVERY
      // getDirectoryHandle error as "name free". A FILE occupying
      // `recording-<ts>` rejects the probe with TypeMismatchError (not
      // NotFoundError), so the probe reported the name free and the follow-up
      // getDirectoryHandle(..., {create: true}) crashed session creation with
      // that same TypeMismatchError. A file-occupied name must instead be
      // treated as taken, so the probe advances to the `-2` suffix.
      const sessionsDir = (await (
        await opfsRoot.getDirectoryHandle('gps-plus-slam')
      ).getDirectoryHandle('sessions')) as MockOPFSDirectoryHandle;
      await sessionsDir.getFileHandle('recording-2026-01-26_10-30-00utc', {
        create: true,
      });

      const result = await createSession(new Date('2026-01-26T10:30:00Z'));

      expect(result.sessionName).toBe('recording-2026-01-26_10-30-00utc-2');
      expect(getSessionHandle()).not.toBeNull();
    });

    it('surfaces unexpected probe errors instead of looping or mislabeling (PR #158 review)', async () => {
      // Why: a systemic storage failure (e.g. InvalidStateError on every
      // getDirectoryHandle call) must fail createSession loudly with the real
      // error. Treating it as "name free" crashes later with a misleading
      // create-time error; treating it as "name taken" (the reviewer's
      // suggestion) would make the suffix probe loop forever. Rethrow is the
      // only behavior that does neither.
      const sessionsDir = (await (
        await opfsRoot.getDirectoryHandle('gps-plus-slam')
      ).getDirectoryHandle('sessions')) as MockOPFSDirectoryHandle;
      vi.spyOn(sessionsDir, 'getDirectoryHandle').mockRejectedValue(
        new DOMException('backing store unavailable', 'InvalidStateError')
      );

      await expect(createSession(new Date())).rejects.toThrow(
        /backing store unavailable/
      );
    });

    it('throws if initOpfsStorage was not called', async () => {
      // Why: Must enforce initialization order
      resetOpfsStorage();
      await expect(createSession(new Date())).rejects.toThrow(
        /not initialized/i
      );
    });
  });

  describe('createSessionInDirectory', () => {
    // Why: the Tour Viewer's troubleshooting recording shares this origin
    // with the Recorder but must NOT land in the Recorder's `sessions/`
    // folder (plan 2026-09-28-0953, review finding 16). It needs the same
    // session layout, the same same-second collision probe and the same
    // write functions - in a parent directory of its own - without a second
    // copy of the probe.
    it('creates the session layout under the given parent and targets the writes at it', async () => {
      const parent = (await opfsRoot.getDirectoryHandle('tour-viewer', {
        create: true,
      })) as MockOPFSDirectoryHandle;

      const result = await createSessionInDirectory(
        parent,
        new Date('2026-09-28T10:30:00Z')
      );
      await writeAction({ type: 'gpsData/setZeroPos' }, 1);

      expect(result.sessionName).toBe('recording-2026-09-28_10-30-00utc');
      const session = (await parent.getDirectoryHandle(
        result.sessionName
      )) as MockOPFSDirectoryHandle;
      expect(getSessionHandle()).toBe(session);
      const actions = (await session.getDirectoryHandle(
        'actions'
      )) as MockOPFSDirectoryHandle;
      expect(actions.getStoredContentAsString('000001.json')).toContain(
        'gpsData/setZeroPos'
      );
      // Needs no initOpfsStorage and creates no `sessions/` folder.
      await expect(
        opfsRoot.getDirectoryHandle('gps-plus-slam')
      ).rejects.toThrow();
    });

    it('probes for a free name in THAT parent, like createSession does', async () => {
      const parent = (await opfsRoot.getDirectoryHandle('tour-viewer', {
        create: true,
      })) as MockOPFSDirectoryHandle;
      const at = new Date('2026-09-28T10:30:00Z');

      const first = await createSessionInDirectory(parent, at);
      const second = await createSessionInDirectory(parent, at);

      expect(first.sessionName).toBe('recording-2026-09-28_10-30-00utc');
      expect(second.sessionName).toBe('recording-2026-09-28_10-30-00utc-2');
    });
  });

  describe('writeAction', () => {
    beforeEach(async () => {
      await initOpfsStorage();
      await createSession(new Date('2026-01-26T10:00:00Z'));
    });

    it('writes action as JSON file with padded index', async () => {
      // Why: Actions must be numbered for deterministic replay order
      const action = { type: 'test/action', payload: { value: 42 } };
      await writeAction(action, 1);

      const sessionHandle =
        getSessionHandle() as unknown as MockOPFSDirectoryHandle;
      const actionsDir = (await sessionHandle.getDirectoryHandle(
        'actions'
      )) as unknown as MockOPFSDirectoryHandle;

      const content = actionsDir.getStoredContentAsString('000001.json');
      expect(content).toBeDefined();

      const parsed = JSON.parse(content!);
      expect(parsed).toEqual(action);
    });

    it('writes a depth sample packed and every action as compact JSON (scan pass S2)', async () => {
      // Why: the packed depth grid is what makes a recording about 17x
      // smaller per sample, and it is applied here, below the store - the
      // in-memory action is never changed. Compact JSON for every action
      // is a further free gain (nothing diffs these files).
      const points = [0, 1, 2, 3].map((i) => ({
        screenX: ((i % 2) + 1) / 3,
        screenY: (Math.floor(i / 2) + 1) / 3,
        depthM: 1.5,
      }));
      const depth = {
        type: 'recording/recordDepthSample',
        payload: {
          timestamp: 1,
          cameraPos: [0, 1, 0],
          cameraRot: [0, 0, 0, 1],
          points,
        },
      };
      await writeAction(depth, 1);
      await writeAction({ type: 'test/action', payload: { value: 42 } }, 2);

      const sessionHandle =
        getSessionHandle() as unknown as MockOPFSDirectoryHandle;
      const actionsDir = (await sessionHandle.getDirectoryHandle(
        'actions'
      )) as unknown as MockOPFSDirectoryHandle;
      const written = JSON.parse(
        actionsDir.getStoredContentAsString('000001.json')!
      ) as { payload: { points: unknown[]; grid: { size: number } } };
      expect(written.payload.points).toEqual([]);
      expect(written.payload.grid.size).toBe(2);
      expect(depth.payload.points).toHaveLength(4);
      expect(actionsDir.getStoredContentAsString('000002.json')).toBe(
        '{"type":"test/action","payload":{"value":42}}'
      );
    });

    it('writes multiple actions with sequential numbering', async () => {
      // Why: Replay requires correct action ordering
      await writeAction({ type: 'action1' }, 1);
      await writeAction({ type: 'action2' }, 2);
      await writeAction({ type: 'action3' }, 100);

      const sessionHandle =
        getSessionHandle() as unknown as MockOPFSDirectoryHandle;
      const actionsDir = (await sessionHandle.getDirectoryHandle(
        'actions'
      )) as unknown as MockOPFSDirectoryHandle;

      expect(actionsDir.getStoredContentAsString('000001.json')).toContain(
        'action1'
      );
      expect(actionsDir.getStoredContentAsString('000002.json')).toContain(
        'action2'
      );
      expect(actionsDir.getStoredContentAsString('000100.json')).toContain(
        'action3'
      );
    });

    it('throws if no active session', async () => {
      // Why: Must have session context before writing
      resetOpfsStorage();
      await expect(writeAction({ type: 'test' }, 1)).rejects.toThrow(
        /no active session/i
      );
    });

    it('aborts writable and propagates error when write fails', async () => {
      // Why: Resource leak prevention - writable must be cleaned up even on errors
      // to avoid file locks and resource exhaustion in OPFS
      const action = { type: 'test/action', payload: { value: 42 } };

      const sessionHandle =
        getSessionHandle() as unknown as MockOPFSDirectoryHandle;
      const actionsDir = (await sessionHandle.getDirectoryHandle(
        'actions'
      )) as unknown as MockOPFSDirectoryHandle;

      const fileHandle = await actionsDir.getFileHandle('000001.json', {
        create: true,
      });

      const mockWritable = {
        write: vi.fn().mockRejectedValue(new Error('Disk full')),
        close: vi.fn().mockResolvedValue(undefined),
        abort: vi.fn().mockResolvedValue(undefined),
      };
      vi.spyOn(fileHandle, 'createWritable').mockResolvedValue(
        mockWritable as unknown as FileSystemWritableFileStream
      );

      await expect(writeAction(action, 1)).rejects.toThrow('Disk full');

      expect(mockWritable.abort).toHaveBeenCalled();
      expect(mockWritable.close).not.toHaveBeenCalled();
    });
  });

  describe('writeFrame', () => {
    beforeEach(async () => {
      await initOpfsStorage();
      await createSession(new Date('2026-01-26T10:00:00Z'));
    });

    it('writes frame blob with padded index', async () => {
      // Why: Frames must be numbered for replay synchronization
      const blob = new Blob(['fake-image-data'], { type: 'image/jpeg' });
      await writeFrame(blob, 1);

      const sessionHandle =
        getSessionHandle() as unknown as MockOPFSDirectoryHandle;
      const framesDir = (await sessionHandle.getDirectoryHandle(
        'images' // renamed from frames/ (Q5)
      )) as unknown as MockOPFSDirectoryHandle;

      const content = framesDir.getStoredContent('frame-000001.jpg');
      expect(content).toBeDefined();
      expect(content!.byteLength).toBeGreaterThan(0);
    });

    it('preserves binary blob content', async () => {
      // Why: Image data must not be corrupted during write
      const originalData = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
      const blob = new Blob([originalData], { type: 'image/jpeg' });
      await writeFrame(blob, 5);

      const sessionHandle =
        getSessionHandle() as unknown as MockOPFSDirectoryHandle;
      const framesDir = (await sessionHandle.getDirectoryHandle(
        'images' // renamed from frames/ (Q5)
      )) as unknown as MockOPFSDirectoryHandle;

      const stored = framesDir.getStoredContent('frame-000005.jpg');
      expect(new Uint8Array(stored!)).toEqual(originalData);
    });

    it('throws if no active session', async () => {
      // Why: Must have session context before writing
      resetOpfsStorage();
      const blob = new Blob(['data']);
      await expect(writeFrame(blob, 1)).rejects.toThrow(/no active session/i);
    });

    it('aborts writable and propagates error when write fails', async () => {
      // Why: Resource leak prevention - writable must be cleaned up even on errors
      const blob = new Blob(['fake-image-data'], { type: 'image/jpeg' });

      const sessionHandle =
        getSessionHandle() as unknown as MockOPFSDirectoryHandle;
      const framesDir = (await sessionHandle.getDirectoryHandle(
        'images' // renamed from frames/ (Q5)
      )) as unknown as MockOPFSDirectoryHandle;

      const fileHandle = await framesDir.getFileHandle('frame-000001.jpg', {
        create: true,
      });

      const mockWritable = {
        write: vi.fn().mockRejectedValue(new Error('Storage quota exceeded')),
        close: vi.fn().mockResolvedValue(undefined),
        abort: vi.fn().mockResolvedValue(undefined),
      };
      vi.spyOn(fileHandle, 'createWritable').mockResolvedValue(
        mockWritable as unknown as FileSystemWritableFileStream
      );

      await expect(writeFrame(blob, 1)).rejects.toThrow(
        'Storage quota exceeded'
      );

      expect(mockWritable.abort).toHaveBeenCalled();
      expect(mockWritable.close).not.toHaveBeenCalled();
    });
  });

  describe('writeSessionMetadata', () => {
    beforeEach(async () => {
      await initOpfsStorage();
      await createSession(new Date('2026-01-26T10:00:00Z'));
    });

    it('writes session.json with metadata', async () => {
      // Why: Metadata is required for session identification and export
      const metadata: SessionMetadata = {
        version: 1,
        startedAt: '2026-01-26T10:00:00.000Z',
        endedAt: '2026-01-26T10:30:00.000Z',
        actionCount: 42,
        frameCount: 21,
        userAgent: 'Test Browser',
      };

      await writeSessionMetadata(metadata);

      const sessionHandle =
        getSessionHandle() as unknown as MockOPFSDirectoryHandle;
      const content = sessionHandle.getStoredContentAsString('session.json');
      expect(content).toBeDefined();

      const parsed = JSON.parse(content!);
      expect(parsed).toEqual(metadata);
    });

    it('writes metadata with optional contextTag', async () => {
      // Why: contextTag replaces the former required scenarioName
      const metadata: SessionMetadata = {
        version: 1,
        startedAt: '2026-01-26T10:00:00.000Z',
        endedAt: '2026-01-26T10:30:00.000Z',
        contextTag: 'my-scenario',
        actionCount: 42,
        frameCount: 21,
        userAgent: 'Test Browser',
      };

      await writeSessionMetadata(metadata);

      const sessionHandle =
        getSessionHandle() as unknown as MockOPFSDirectoryHandle;
      const content = sessionHandle.getStoredContentAsString('session.json');
      const parsed = JSON.parse(content!) as { contextTag?: string };
      expect(parsed.contextTag).toBe('my-scenario');
    });

    it('aborts writable and propagates error when write fails', async () => {
      // Why: Resource leak prevention - writable must be cleaned up even on errors
      const metadata: SessionMetadata = {
        version: 1,
        startedAt: '2026-01-26T10:00:00.000Z',
        endedAt: '2026-01-26T10:30:00.000Z',
        actionCount: 42,
        frameCount: 21,
        userAgent: 'Test Browser',
      };

      const sessionHandle =
        getSessionHandle() as unknown as MockOPFSDirectoryHandle;

      const fileHandle = await sessionHandle.getFileHandle('session.json', {
        create: true,
      });

      const mockWritable = {
        write: vi.fn().mockRejectedValue(new Error('Write failed')),
        close: vi.fn().mockResolvedValue(undefined),
        abort: vi.fn().mockResolvedValue(undefined),
      };
      vi.spyOn(fileHandle, 'createWritable').mockResolvedValue(
        mockWritable as unknown as FileSystemWritableFileStream
      );

      await expect(writeSessionMetadata(metadata)).rejects.toThrow(
        'Write failed'
      );

      expect(mockWritable.abort).toHaveBeenCalled();
      expect(mockWritable.close).not.toHaveBeenCalled();
    });
  });

  describe('listSessions', () => {
    beforeEach(async () => {
      await initOpfsStorage();
    });

    it('returns empty array when no sessions exist', async () => {
      // Why: Fresh install should show no sessions
      const sessions = await listSessions();
      expect(sessions).toEqual([]);
    });

    it('returns all session names', async () => {
      // Why: callers need to enumerate available sessions for replay/export
      await createSession(new Date('2026-01-26T10:00:00Z'));
      await createSession(new Date('2026-01-26T11:00:00Z'));

      const sessions = await listSessions();
      expect(sessions).toHaveLength(2);
      expect(sessions).toContain('recording-2026-01-26_10-00-00utc');
      expect(sessions).toContain('recording-2026-01-26_11-00-00utc');
    });
  });

  describe('checkStorageQuota', () => {
    it('returns safe default when Storage Manager API is unavailable', async () => {
      // Why: On unsupported platforms, checkStorageQuota should not throw but
      // return a safe fallback so callers can handle gracefully.

      const { checkStorageQuota } = await import('./opfs-storage');

      const originalEstimate = navigator.storage.estimate.bind(
        navigator.storage
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      (navigator.storage as any).estimate = undefined as unknown;

      try {
        const result = await checkStorageQuota();
        expect(result).toEqual({ available: 0, used: 0 });
      } finally {
        navigator.storage.estimate = originalEstimate;
      }
    });
  });
});
