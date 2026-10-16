/**
 * persistence.test.ts
 *
 * Unit tests for PersistenceServiceImpl.
 * These run in a Node/jsdom-compatible environment via Vitest.
 * Browser-exclusive APIs (showOpenFilePicker, FileSystemFileHandle,
 * URL.createObjectURL, etc.) are mocked inline.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PersistenceServiceImpl, sanitizeFilename } from '../src/persistence/service';
import {
  ContainerSessionMismatchError,
  ExportFailedError,
  NativeHandleMissingError,
  NativePermissionDeniedError,
  NativeWriteFailedError,
  UnsupportedEnvironmentError,
} from '../src/persistence/errors';
import { IKmzContainer } from '../src/contracts/kmz-container';
import { SaveStatus } from '../src/contracts/persistence';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers / Mocks
// ─────────────────────────────────────────────────────────────────────────────

/** Build a minimal IKmzContainer stub whose save() returns a small buffer. */
function makeContainer(saveResult: ArrayBuffer | Error = new ArrayBuffer(8)): IKmzContainer {
  return {
    open: vi.fn().mockResolvedValue(undefined),
    getDocKml: vi.fn().mockReturnValue(''),
    setDocKml: vi.fn(),
    listAssets: vi.fn().mockReturnValue([]),
    save: vi.fn().mockImplementation(async () => {
      if (saveResult instanceof Error) throw saveResult;
      return saveResult;
    }),
    getAssetProvider: vi.fn(),
    dispose: vi.fn(),
  } as unknown as IKmzContainer;
}

/** Build a FileSystemWritableFileStream mock. */
function makeWritable(failAt?: 'write' | 'close'): FileSystemWritableFileStream {
  return {
    write: vi.fn().mockImplementation(async () => {
      if (failAt === 'write') throw new DOMException('permission denied', 'NotAllowedError');
    }),
    close: vi.fn().mockImplementation(async () => {
      if (failAt === 'close') throw new DOMException('permission denied', 'NotAllowedError');
    }),
    seek: vi.fn(),
    truncate: vi.fn(),
    abort: vi.fn(),
    getWriter: vi.fn(),
    locked: false,
  } as unknown as FileSystemWritableFileStream;
}

/** Build a FileSystemFileHandle mock. */
function makeHandle(writableOrFail?: FileSystemWritableFileStream | Error): FileSystemFileHandle {
  return {
    kind: 'file',
    name: 'test.kmz',
    isSameEntry: vi.fn().mockResolvedValue(false),
    queryPermission: vi.fn().mockResolvedValue('granted'),
    requestPermission: vi.fn().mockResolvedValue('granted'),
    createWritable: vi.fn().mockImplementation(async () => {
      if (writableOrFail instanceof Error) throw writableOrFail;
      return writableOrFail ?? makeWritable();
    }),
    getFile: vi.fn().mockResolvedValue(new File([], 'test.kmz')),
  } as unknown as FileSystemFileHandle;
}

function setupDomGlobals() {
  if (typeof globalThis.navigator === 'undefined') {
    Object.defineProperty(globalThis, 'navigator', {
      value: { userAgent: 'Mozilla/5.0' },
      writable: true,
      configurable: true,
    });
  }
  if (typeof globalThis.window === 'undefined') {
    (globalThis as any).window = globalThis;
  }
  if (typeof globalThis.document === 'undefined') {
    (globalThis as any).document = {
      createElement: (tag: string) => ({
        href: '',
        download: '',
        style: {},
        click: vi.fn(),
      }),
      body: {
        appendChild: vi.fn(),
        removeChild: vi.fn(),
      },
    };
  }
  if (typeof globalThis.DOMException === 'undefined') {
    (globalThis as any).DOMException = class DOMException extends Error {
      constructor(message: string, name: string) {
        super(message);
        this.name = name;
      }
    };
  }
  if (typeof globalThis.URL === 'undefined') {
    (globalThis as any).URL = class URL { };
  }
  if (typeof (globalThis.URL as any).createObjectURL === 'undefined') {
    (globalThis.URL as any).createObjectURL = vi.fn().mockReturnValue('blob:mock-url');
    (globalThis.URL as any).revokeObjectURL = vi.fn();
  }
}

/**
 * Patch navigator.userAgent and window.showOpenFilePicker so that
 * the service believes it is running in Chrome with File System Access.
 */
function patchChrome(
  pickerResult?: { handle: FileSystemFileHandle } | Error,
): () => void {
  setupDomGlobals();
  const originalDescriptor = Object.getOwnPropertyDescriptor(navigator, 'userAgent');
  Object.defineProperty(navigator, 'userAgent', {
    value: 'Mozilla/5.0 Chrome/120.0.0.0 Safari/537.36',
    configurable: true,
  });

  const pickerFn = vi.fn().mockImplementation(async () => {
    if (pickerResult instanceof Error) throw pickerResult;
    return [pickerResult?.handle ?? makeHandle()];
  });
  (globalThis.window as any).showOpenFilePicker = pickerFn;

  return () => {
    if (originalDescriptor) {
      Object.defineProperty(navigator, 'userAgent', originalDescriptor);
    }
    delete (globalThis.window as any).showOpenFilePicker;
  };
}

/** Inject a pre-bound session with a container + handle directly, bypassing browser picker. */
async function openWithInjectedHandle(
  svc: PersistenceServiceImpl,
  container: IKmzContainer,
  handle: FileSystemFileHandle | null,
): Promise<void> {
  setupDomGlobals();
  const s = svc as any;
  s._teardown();
  s._session.sessionToken++;
  s._session.activeContainer = container;
  s._session.activeFileHandle = handle;
  s._session.fileName = 'test.kmz';
  s._session.opfsFileName = 'opfs-working-copy-test.kmz';
  s._session.mode = handle ? 'native' : (s._session.opfsFallbackEnabled ? 'opfs' : 'detached');
  s._session.dirtyVersion = 0;
  s._session.persistedVersion = 0;
  s._session.isSaving = false;
  s._session.pendingFlush = false;
  s._session.lastError = null;
  s._setStatus('saved');
}

/** Mock URL.createObjectURL / revokeObjectURL on the global object. */
function mockUrlApis(): { createObjectURL: ReturnType<typeof vi.fn>; revokeObjectURL: ReturnType<typeof vi.fn> } {
  setupDomGlobals();
  const createObjectURL = vi.fn().mockReturnValue('blob:mock-url');
  const revokeObjectURL = vi.fn();
  (globalThis.URL as any).createObjectURL = createObjectURL;
  (globalThis.URL as any).revokeObjectURL = revokeObjectURL;
  return { createObjectURL, revokeObjectURL };
}

// ─────────────────────────────────────────────────────────────────────────────
// Test suite
// ─────────────────────────────────────────────────────────────────────────────

describe('PersistenceServiceImpl', () => {
  let svc: PersistenceServiceImpl;

  beforeEach(() => {
    setupDomGlobals();
    svc = new PersistenceServiceImpl();
    vi.useFakeTimers();
  });

  afterEach(() => {
    svc.dispose();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // ── Initial state ──────────────────────────────────────────────────────────

  describe('initial state', () => {
    it('starts with status idle', () => {
      expect(svc.status).toBe('idle');
    });

    it('hasNativeFileAccess reflects Chrome + API presence', () => {
      expect(typeof svc.hasNativeFileAccess).toBe('boolean');
    });

    it('hasNativeFileAccess is true when Chrome UA + showOpenFilePicker present', () => {
      const restore = patchChrome();
      try {
        expect(svc.hasNativeFileAccess).toBe(true);
      } finally {
        restore();
      }
    });

    it('hasNativeFileAccess is false when Chrome UA but no showOpenFilePicker', () => {
      Object.defineProperty(navigator, 'userAgent', {
        value: 'Mozilla/5.0 Chrome/120.0.0.0 Safari/537.36',
        configurable: true,
      });
      delete (window as any).showOpenFilePicker;
      expect(svc.hasNativeFileAccess).toBe(false);
    });

    it('hasNativeFileAccess is false in Edge (Edg/ UA suffix)', () => {
      Object.defineProperty(navigator, 'userAgent', {
        value: 'Mozilla/5.0 Chrome/120 Edg/120.0.0.0',
        configurable: true,
      });
      (window as any).showOpenFilePicker = vi.fn();
      expect(svc.hasNativeFileAccess).toBe(false);
      delete (window as any).showOpenFilePicker;
    });
  });

  // ── UnsupportedEnvironmentError ────────────────────────────────────────────

  describe('open() environment checks', () => {
    it('throws UnsupportedEnvironmentError when not Chrome', async () => {
      Object.defineProperty(navigator, 'userAgent', {
        value: 'Mozilla/5.0 Firefox/115.0',
        configurable: true,
      });
      await expect(svc.open()).rejects.toBeInstanceOf(UnsupportedEnvironmentError);
      expect(svc.status).toBe('error');
    });

    it('throws UnsupportedEnvironmentError in Chrome when showOpenFilePicker absent', async () => {
      Object.defineProperty(navigator, 'userAgent', {
        value: 'Mozilla/5.0 Chrome/120.0.0.0 Safari/537.36',
        configurable: true,
      });
      delete (window as any).showOpenFilePicker;
      await expect(svc.open()).rejects.toBeInstanceOf(UnsupportedEnvironmentError);
    });

    it('throws NativePermissionDeniedError when picker returns denied permission', async () => {
      const handle = {
        ...makeHandle(),
        requestPermission: vi.fn().mockResolvedValue('denied'),
        getFile: vi.fn().mockResolvedValue(new File([], 'test.kmz')),
      } as unknown as FileSystemFileHandle;
      const restore = patchChrome({ handle });
      try {
        await expect(svc.open()).rejects.toBeInstanceOf(NativePermissionDeniedError);
      } finally {
        restore();
      }
    });
  });

  // ── Container identity / session mismatch ─────────────────────────────────

  describe('Container-session identity checks', () => {
    it('save() rejects a container from a different session', async () => {
      const c1 = makeContainer();
      const c2 = makeContainer();
      await openWithInjectedHandle(svc, c1, makeHandle());
      await expect(svc.save(c2)).rejects.toBeInstanceOf(ContainerSessionMismatchError);
    });

    it('flush() rejects a container from a different session', async () => {
      const c1 = makeContainer();
      const c2 = makeContainer();
      await openWithInjectedHandle(svc, c1, makeHandle());
      await expect(svc.flush(c2)).rejects.toBeInstanceOf(ContainerSessionMismatchError);
    });

    it('downloadAs() rejects a container from a different session', async () => {
      const c1 = makeContainer();
      const c2 = makeContainer();
      await openWithInjectedHandle(svc, c1, makeHandle());
      mockUrlApis();
      await expect(svc.downloadAs(c2, 'out.kmz')).rejects.toBeInstanceOf(ContainerSessionMismatchError);
    });

    it('save() does not mutate status when mismatch is thrown', async () => {
      const c1 = makeContainer();
      const c2 = makeContainer();
      await openWithInjectedHandle(svc, c1, makeHandle());
      try { await svc.save(c2); } catch (_) { }
      // State unchanged.
      expect(svc.status).toBe('saved');
    });
  });

  // ── Status transitions ─────────────────────────────────────────────────────

  describe('Status transitions', () => {
    it('transitions idle → saved after open with handle', async () => {
      const statuses: SaveStatus[] = [];
      svc.onStatusChange((s) => statuses.push(s));
      const c = makeContainer();
      await openWithInjectedHandle(svc, c, makeHandle());
      expect(svc.status).toBe('saved');
      expect(statuses).toContain('saved');
    });

    it('transitions to saving then saved on successful save()', async () => {
      const statuses: SaveStatus[] = [];
      svc.onStatusChange((s) => statuses.push(s));
      const c = makeContainer();
      await openWithInjectedHandle(svc, c, makeHandle(makeWritable()));
      statuses.length = 0;
      await svc.save(c);
      expect(statuses[0]).toBe('saving');
      expect(statuses[statuses.length - 1]).toBe('saved');
      expect(svc.status).toBe('saved');
    });

    it('transitions to error when write fails', async () => {
      const c = makeContainer();
      await openWithInjectedHandle(svc, c, makeHandle(makeWritable('write')));
      await expect(svc.save(c)).rejects.toBeDefined();
      expect(svc.status).toBe('error');
    });

    it('transitions to error when container.save() throws', async () => {
      const c = makeContainer(new Error('serialization failed'));
      await openWithInjectedHandle(svc, c, makeHandle(makeWritable()));
      await expect(svc.save(c)).rejects.toBeInstanceOf(NativeWriteFailedError);
      expect(svc.status).toBe('error');
    });

    it('transitions to idle on dispose()', async () => {
      const c = makeContainer();
      await openWithInjectedHandle(svc, c, makeHandle());
      svc.dispose();
      expect(svc.status).toBe('idle');
    });

    it('emits status events to all registered listeners', async () => {
      const log1: SaveStatus[] = [];
      const log2: SaveStatus[] = [];
      svc.onStatusChange((s) => log1.push(s));
      svc.onStatusChange((s) => log2.push(s));
      const c = makeContainer();
      await openWithInjectedHandle(svc, c, makeHandle(makeWritable()));
      await svc.save(c);
      expect(log1.length).toBeGreaterThan(0);
      expect(log2.length).toBeGreaterThan(0);
    });

    it('onStatusChange unsubscribe stops future events', async () => {
      const log: SaveStatus[] = [];
      const unsub = svc.onStatusChange((s) => log.push(s));
      unsub();
      const c = makeContainer();
      await openWithInjectedHandle(svc, c, makeHandle(makeWritable()));
      await svc.save(c);
      expect(log).toHaveLength(0);
    });

    it('listener exceptions do not crash the service', async () => {
      svc.onStatusChange(() => { throw new Error('listener crash'); });
      const c = makeContainer();
      await openWithInjectedHandle(svc, c, makeHandle(makeWritable()));
      await expect(svc.save(c)).resolves.toBeUndefined();
    });

    it('status clears error on next successful save (retry path)', async () => {
      // First write fails.
      const c = makeContainer();
      await openWithInjectedHandle(svc, c, makeHandle(makeWritable('write')));
      await expect(svc.save(c)).rejects.toBeDefined();
      expect(svc.status).toBe('error');

      // Swap in a working handle and retry.
      (svc as any)._session.activeFileHandle = makeHandle(makeWritable());
      svc.notifyChange();
      await svc.save(c);
      expect(svc.status).toBe('saved');
    });
  });

  // ── save() behaviour ───────────────────────────────────────────────────────

  describe('save()', () => {
    it('executes a write even when dirtyVersion equals persistedVersion (explicit call)', async () => {
      const c = makeContainer();
      await openWithInjectedHandle(svc, c, makeHandle(makeWritable()));
      // No notifyChange — dirtyVersion = persistedVersion = 0.
      await svc.save(c);
      expect(c.save).toHaveBeenCalledTimes(1);
      expect(svc.status).toBe('saved');
    });

    it('cancels pending debounce timer before executing', async () => {
      const c = makeContainer();
      await openWithInjectedHandle(svc, c, makeHandle(makeWritable()));
      svc.notifyChange();       // Arms debounce timer.
      await svc.save(c);        // Should cancel timer and save immediately.
      await vi.advanceTimersByTimeAsync(700);
      expect(c.save).toHaveBeenCalledTimes(1); // Only one save, timer did not fire again.
    });
  });

  // ── open -> edit -> flush -> reopen roundtrip ─────────────────────────────

  describe('open -> edit -> flush -> reopen workflow', () => {
    it('preserves KML edits across open -> edit -> flush -> reopen', async () => {
      let docKml = '<kml><Placemark><name>Original</name></Placemark></kml>';
      const c = makeContainer();
      (c.getDocKml as any).mockImplementation(() => docKml);
      (c.setDocKml as any).mockImplementation((kml: string) => { docKml = kml; });
      (c.save as any).mockImplementation(async () => new TextEncoder().encode(docKml).buffer);

      await openWithInjectedHandle(svc, c, makeHandle());

      // Edit
      c.setDocKml('<kml><Placemark><name>Edited Marker</name></Placemark></kml>');
      svc.notifyChange();
      expect(svc.hasUnsavedChanges).toBe(true);

      // Flush
      await svc.flush(c);
      expect(svc.status).toBe('saved');
      expect(svc.hasUnsavedChanges).toBe(false);

      // Reopen in fallback
      const file = new File([new TextEncoder().encode(docKml)], 'test.kmz', { type: 'application/vnd.google-earth.kmz' });
      const reopenedContainer = await svc.open(file);
      expect(reopenedContainer).toBeDefined();
    });
  });

  // ── OPFS working copy fallback ────────────────────────────────────────────

  describe('OPFS working copy fallback', () => {
    it('degrades to OPFS fallback instead of throwing when native handle is absent', async () => {
      const c = makeContainer();
      await openWithInjectedHandle(svc, c, null);

      svc.notifyChange();
      await expect(svc.flush(c)).resolves.toBeUndefined();
      expect(svc.status).toBe('saved');
      expect(svc.mode).toBe('opfs');
    });

    it('requests write permission during open() picker flow', async () => {
      const requestPerm = vi.fn().mockResolvedValue('granted');
      const handle = {
        ...makeHandle(),
        requestPermission: requestPerm,
      } as unknown as FileSystemFileHandle;

      const restore = patchChrome({ handle });
      try {
        await svc.open();
        expect(requestPerm).toHaveBeenCalledWith({ mode: 'readwrite' });
        expect(svc.status).toBe('saved');
      } finally {
        restore();
      }
    });

    it('throws NativePermissionDeniedError when write permission is denied on native handle', async () => {
      const handle = {
        ...makeHandle(),
        queryPermission: vi.fn().mockResolvedValue('denied'),
        requestPermission: vi.fn().mockResolvedValue('denied'),
      } as unknown as FileSystemFileHandle;

      const c = makeContainer();
      await openWithInjectedHandle(svc, c, handle);
      svc.notifyChange();

      await expect(svc.flush(c)).rejects.toBeInstanceOf(NativePermissionDeniedError);
      expect(svc.status).toBe('error');
    });
  });

  // ── NativeHandleMissingError (detached session without fallback) ─────────

  describe('Detached session (no handle)', () => {
    it('save() fails with NativeHandleMissingError when no handle and fallback disabled', async () => {
      svc.opfsFallbackEnabled = false;
      const c = makeContainer();
      await openWithInjectedHandle(svc, c, null);
      await expect(svc.save(c)).rejects.toBeInstanceOf(NativeHandleMissingError);
      expect(svc.status).toBe('error');
    });

    it('flush() fails with NativeHandleMissingError in detached mode when fallback disabled', async () => {
      svc.opfsFallbackEnabled = false;
      const c = makeContainer();
      await openWithInjectedHandle(svc, c, null);
      svc.notifyChange();
      await expect(svc.flush(c)).rejects.toBeInstanceOf(NativeHandleMissingError);
      expect(svc.status).toBe('error');
    });

    it('detached session → save fails → downloadAs still works (recovery flow)', async () => {
      svc.opfsFallbackEnabled = false;
      const c = makeContainer();
      await openWithInjectedHandle(svc, c, null);
      await expect(svc.save(c)).rejects.toBeInstanceOf(NativeHandleMissingError);

      const { revokeObjectURL } = mockUrlApis();
      await expect(svc.downloadAs(c, 'export.kmz')).resolves.toBeUndefined();
      expect(revokeObjectURL).toHaveBeenCalled();
    });
  });

  // ── Permission error classification ───────────────────────────────────────

  describe('Permission errors', () => {
    it('classifies NotAllowedError from createWritable as NativePermissionDeniedError', async () => {
      const c = makeContainer();
      await openWithInjectedHandle(svc, c, makeHandle(new DOMException('no access', 'NotAllowedError')));
      await expect(svc.save(c)).rejects.toBeInstanceOf(NativePermissionDeniedError);
    });

    it('classifies SecurityError from createWritable as NativePermissionDeniedError', async () => {
      const c = makeContainer();
      await openWithInjectedHandle(svc, c, makeHandle(new DOMException('security', 'SecurityError')));
      await expect(svc.save(c)).rejects.toBeInstanceOf(NativePermissionDeniedError);
    });

    it('classifies generic Error from createWritable as NativeWriteFailedError', async () => {
      const c = makeContainer();
      await openWithInjectedHandle(svc, c, makeHandle(new Error('disk full')));
      await expect(svc.save(c)).rejects.toBeInstanceOf(NativeWriteFailedError);
    });

    it('classifies NotAllowedError from write() as NativePermissionDeniedError', async () => {
      const c = makeContainer();
      await openWithInjectedHandle(svc, c, makeHandle(makeWritable('write')));
      await expect(svc.save(c)).rejects.toBeInstanceOf(NativePermissionDeniedError);
    });

    it('classifies NotAllowedError from close() as NativePermissionDeniedError', async () => {
      const c = makeContainer();
      await openWithInjectedHandle(svc, c, makeHandle(makeWritable('close')));
      await expect(svc.save(c)).rejects.toBeInstanceOf(NativePermissionDeniedError);
    });

    it('dirty version stays > persistedVersion after permission failure (data not lost)', async () => {
      const c = makeContainer();
      await openWithInjectedHandle(svc, c, makeHandle(new DOMException('no access', 'NotAllowedError')));
      svc.notifyChange(); // dirtyVersion = 1
      await expect(svc.save(c)).rejects.toBeDefined();
      expect((svc as any)._session.persistedVersion).toBe(0);
      expect((svc as any)._session.dirtyVersion).toBe(1);
    });

    it('retry succeeds after permission is re-granted (recovery path)', async () => {
      const c = makeContainer();
      await openWithInjectedHandle(svc, c, makeHandle(new DOMException('no access', 'NotAllowedError')));
      svc.notifyChange();
      await expect(svc.save(c)).rejects.toBeInstanceOf(NativePermissionDeniedError);

      // Simulate user re-granting permission by swapping the handle.
      (svc as any)._session.activeFileHandle = makeHandle(makeWritable());
      await svc.save(c);

      expect(svc.status).toBe('saved');
      expect((svc as any)._session.persistedVersion).toBeGreaterThan(0);
    });
  });

  // ── Session token stale-write guard ───────────────────────────────────────

  describe('Session token stale guard', () => {
    it('does not mutate status when session is disposed mid-save', async () => {
      let resolveContainerSave!: (buf: ArrayBuffer) => void;
      const slowContainer: IKmzContainer = {
        open: vi.fn(),
        getDocKml: vi.fn().mockReturnValue(''),
        setDocKml: vi.fn(),
        listAssets: vi.fn().mockReturnValue([]),
        save: vi.fn().mockImplementation(
          () => new Promise<ArrayBuffer>((resolve) => { resolveContainerSave = resolve; }),
        ),
        getAssetProvider: vi.fn(),
        dispose: vi.fn(),
      } as unknown as IKmzContainer;

      await openWithInjectedHandle(svc, slowContainer, makeHandle(makeWritable()));
      const savePromise = svc.save(slowContainer).catch(() => { });

      // Dispose (increments token) while save is blocked inside container.save().
      svc.dispose();
      resolveContainerSave(new ArrayBuffer(8));
      await savePromise;

      expect(svc.status).toBe('idle'); // From dispose, not from stale save.
    });

    it('stale completion after open() on a new file does not overwrite new session state', async () => {
      let resolveContainerSave!: (buf: ArrayBuffer) => void;
      let callCount = 0;
      const slowContainer: IKmzContainer = {
        open: vi.fn(),
        getDocKml: vi.fn().mockReturnValue(''),
        setDocKml: vi.fn(),
        listAssets: vi.fn().mockReturnValue([]),
        save: vi.fn().mockImplementation(() => {
          callCount++;
          if (callCount === 1) {
            return new Promise<ArrayBuffer>((resolve) => { resolveContainerSave = resolve; });
          }
          return Promise.resolve(new ArrayBuffer(8));
        }),
        getAssetProvider: vi.fn(),
        dispose: vi.fn(),
      } as unknown as IKmzContainer;

      // Session 1: save is blocked.
      await openWithInjectedHandle(svc, slowContainer, makeHandle(makeWritable()));
      const oldSavePromise = svc.save(slowContainer).catch(() => { });

      // Session 2: completely new container.
      const newContainer = makeContainer();
      await openWithInjectedHandle(svc, newContainer, makeHandle(makeWritable()));

      // Unblock old save — must not overwrite session 2.
      resolveContainerSave(new ArrayBuffer(8));
      await oldSavePromise;

      expect((svc as any)._session.activeContainer).toBe(newContainer);
      expect(svc.status).toBe('saved');
    });
  });

  // ── Debounce ──────────────────────────────────────────────────────────────

  describe('notifyChange debounce', () => {
    it('schedules an autosave after debounce window', async () => {
      const c = makeContainer();
      await openWithInjectedHandle(svc, c, makeHandle(makeWritable()));
      svc.notifyChange();
      expect(c.save).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(600);
      expect(c.save).toHaveBeenCalledTimes(1);
      expect(svc.status).toBe('saved');
    });

    it('resets timer on rapid notifyChange calls (coalesces)', async () => {
      const c = makeContainer();
      await openWithInjectedHandle(svc, c, makeHandle(makeWritable()));
      svc.notifyChange();
      await vi.advanceTimersByTimeAsync(300);
      svc.notifyChange();
      await vi.advanceTimersByTimeAsync(300);
      svc.notifyChange();
      await vi.advanceTimersByTimeAsync(600);
      expect(c.save).toHaveBeenCalledTimes(1);
    });

    it('notifyChange with no active session is a no-op (no throw)', () => {
      expect(() => svc.notifyChange()).not.toThrow();
    });

    it('notifyChange without session emits a console.warn', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => { });
      svc.notifyChange();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('[persistence]'));
    });

    it('rapid burst of 100 notifyChange produces at most 2 container.save() calls (bounded)', async () => {
      const c = makeContainer();
      await openWithInjectedHandle(svc, c, makeHandle(makeWritable()));
      for (let i = 0; i < 100; i++) svc.notifyChange();
      await vi.advanceTimersByTimeAsync(2000);
      expect((c.save as ReturnType<typeof vi.fn>).mock.calls.length).toBeLessThanOrEqual(2);
    });
  });

  // ── Flush semantics ───────────────────────────────────────────────────────

  describe('flush()', () => {
    it('immediately writes if dirty without waiting for debounce timer', async () => {
      const c = makeContainer();
      await openWithInjectedHandle(svc, c, makeHandle(makeWritable()));
      svc.notifyChange();
      await svc.flush(c);
      expect(c.save).toHaveBeenCalledTimes(1);
      expect(svc.status).toBe('saved');
    });

    it('does not call save when not dirty', async () => {
      const c = makeContainer();
      await openWithInjectedHandle(svc, c, makeHandle(makeWritable()));
      await svc.flush(c);
      expect(c.save).not.toHaveBeenCalled();
    });

    it('cancels pending debounce timer before flushing', async () => {
      const c = makeContainer();
      await openWithInjectedHandle(svc, c, makeHandle(makeWritable()));
      svc.notifyChange();    // Arms timer.
      await svc.flush(c);    // Flushes immediately.
      await vi.advanceTimersByTimeAsync(1000);
      expect(c.save).toHaveBeenCalledTimes(1); // Only from flush, not the cancelled timer.
    });

    it('pendingFlush: waits for in-flight save then drains remaining dirty (plan Flow D)', async () => {
      let resolveFirst!: (buf: ArrayBuffer) => void;
      let saveCount = 0;
      const slowContainer: IKmzContainer = {
        open: vi.fn(),
        getDocKml: vi.fn().mockReturnValue(''),
        setDocKml: vi.fn(),
        listAssets: vi.fn().mockReturnValue([]),
        save: vi.fn().mockImplementation(() => {
          saveCount++;
          if (saveCount === 1) return new Promise<ArrayBuffer>((resolve) => { resolveFirst = resolve; });
          return Promise.resolve(new ArrayBuffer(8));
        }),
        getAssetProvider: vi.fn(),
        dispose: vi.fn(),
      } as unknown as IKmzContainer;

      await openWithInjectedHandle(svc, slowContainer, makeHandle(makeWritable()));

      svc.notifyChange(); // dirtyVersion = 1
      const savePromise = svc.save(slowContainer); // blocked

      svc.notifyChange(); // dirtyVersion = 2 arrives while save in-flight

      // flush() must wait for the in-flight save, then persist dirtyVersion=2.
      const flushPromise = svc.flush(slowContainer);

      resolveFirst(new ArrayBuffer(8)); // Unblock first save.
      await savePromise;
      await flushPromise;

      expect(saveCount).toBeGreaterThanOrEqual(2);
      expect(svc.status).toBe('saved');
    });

    it('flush before dispose: latest dirty exactly once when not dirtied again', async () => {
      const c = makeContainer();
      await openWithInjectedHandle(svc, c, makeHandle(makeWritable()));
      svc.notifyChange(); // dirtyVersion = 1
      await svc.flush(c);
      svc.dispose();
      expect(c.save).toHaveBeenCalledTimes(1);
    });
  });

  // ── Large-file guardrails ─────────────────────────────────────────────────

  describe('Large-file guardrails', () => {
    it('throws NativeWriteFailedError when bytes exceed 300 MB', async () => {
      const c = makeContainer(new ArrayBuffer(301 * 1024 * 1024));
      await openWithInjectedHandle(svc, c, makeHandle(makeWritable()));
      svc.notifyChange();
      await expect(svc.save(c)).rejects.toBeInstanceOf(NativeWriteFailedError);
      expect(svc.status).toBe('error');
    });

    it('error message for oversized buffer contains the byte count', async () => {
      const byteCount = 301 * 1024 * 1024;
      const c = makeContainer(new ArrayBuffer(byteCount));
      await openWithInjectedHandle(svc, c, makeHandle(makeWritable()));
      let err: Error | undefined;
      try { await svc.save(c); } catch (e) { err = e as Error; }
      expect(err?.message).toContain(String(byteCount));
    });

    it('logs a warning for buffers between 100 MB and 300 MB', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => { });
      const c = makeContainer(new ArrayBuffer(150 * 1024 * 1024));
      await openWithInjectedHandle(svc, c, makeHandle(makeWritable()));
      svc.notifyChange();
      await svc.save(c);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Large file'));
    });

    it('does not warn for buffers under 100 MB', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => { });
      const c = makeContainer(new ArrayBuffer(50 * 1024 * 1024));
      await openWithInjectedHandle(svc, c, makeHandle(makeWritable()));
      await svc.save(c);
      expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('Large file'));
    });

    it('persistedVersion unchanged after oversized buffer failure', async () => {
      const c = makeContainer(new ArrayBuffer(301 * 1024 * 1024));
      await openWithInjectedHandle(svc, c, makeHandle(makeWritable()));
      svc.notifyChange(); // dirtyVersion = 1
      await expect(svc.save(c)).rejects.toBeDefined();
      expect((svc as any)._session.persistedVersion).toBe(0);
    });
  });

  // ── persistedVersion tracking ─────────────────────────────────────────────

  describe('dirtyVersion / persistedVersion tracking', () => {
    it('status remains saved when dirtyVersion equals persistedVersion after save', async () => {
      const c = makeContainer();
      await openWithInjectedHandle(svc, c, makeHandle(makeWritable()));
      svc.notifyChange(); // dirtyVersion = 1
      await svc.save(c);  // persistedVersion = 1
      expect(svc.status).toBe('saved');
    });

    it('persistedVersion equals dirtyVersion snapshot after successful write', async () => {
      const c = makeContainer();
      await openWithInjectedHandle(svc, c, makeHandle(makeWritable()));
      svc.notifyChange(); // dirtyVersion = 1
      svc.notifyChange(); // dirtyVersion = 2
      await svc.save(c);
      expect((svc as any)._session.persistedVersion).toBe(2);
    });

    it('schedules follow-up save when new change arrives during in-flight write', async () => {
      let resolveContainerSave!: (buf: ArrayBuffer) => void;
      let containerSaveCalls = 0;
      const slowContainer: IKmzContainer = {
        open: vi.fn(),
        getDocKml: vi.fn().mockReturnValue(''),
        setDocKml: vi.fn(),
        listAssets: vi.fn().mockReturnValue([]),
        save: vi.fn().mockImplementation(async () => {
          containerSaveCalls++;
          if (containerSaveCalls === 1)
            return new Promise<ArrayBuffer>((resolve) => { resolveContainerSave = resolve; });
          return new ArrayBuffer(8);
        }),
        getAssetProvider: vi.fn(),
        dispose: vi.fn(),
      } as unknown as IKmzContainer;

      await openWithInjectedHandle(svc, slowContainer, makeHandle(makeWritable()));
      svc.notifyChange(); // dirtyVersion = 1
      const savePromise = svc.save(slowContainer); // blocked
      svc.notifyChange(); // dirtyVersion = 2 while blocked
      resolveContainerSave(new ArrayBuffer(8));
      await savePromise;
      await vi.advanceTimersByTimeAsync(700);
      expect(containerSaveCalls).toBe(2);
    });

    it('no follow-up save when dirtyVersion equals persistedVersion at commit', async () => {
      const c = makeContainer();
      await openWithInjectedHandle(svc, c, makeHandle(makeWritable()));
      svc.notifyChange(); // dirtyVersion = 1
      await svc.save(c);  // no new notifyChange during save
      await vi.advanceTimersByTimeAsync(700);
      expect(c.save).toHaveBeenCalledTimes(1);
    });
  });

  // ── downloadAs ────────────────────────────────────────────────────────────

  describe('downloadAs()', () => {
    it('triggers a download (createObjectURL called once)', async () => {
      const c = makeContainer();
      await openWithInjectedHandle(svc, c, makeHandle());
      const { createObjectURL } = mockUrlApis();
      await svc.downloadAs(c, 'my map.kmz');
      expect(createObjectURL).toHaveBeenCalledOnce();
    });

    it('does NOT update persistedVersion after export', async () => {
      const c = makeContainer();
      await openWithInjectedHandle(svc, c, makeHandle());
      mockUrlApis();
      svc.notifyChange(); // dirtyVersion = 1
      await svc.downloadAs(c, 'out.kmz');
      expect((svc as any)._session.persistedVersion).toBe(0);
      expect((svc as any)._session.dirtyVersion).toBe(1);
    });

    it('exported bytes are exactly container.save() output (golden)', async () => {
      const expected = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0xDE, 0xAD]).buffer;
      const c = makeContainer(expected);
      await openWithInjectedHandle(svc, c, makeHandle());

      let captured: BlobPart[] | undefined;
      const origBlob = global.Blob;
      (global as any).Blob = class MockBlob {
        constructor(parts: BlobPart[], _opts?: BlobPropertyBag) { captured = parts; }
      };
      mockUrlApis();
      await svc.downloadAs(c, 'check.kmz');
      (global as any).Blob = origBlob;

      expect(captured).toBeDefined();
      expect(captured![0]).toBe(expected); // Same reference — no copy/transform.
    });

    it('revokes object URL in success path', async () => {
      const c = makeContainer();
      await openWithInjectedHandle(svc, c, makeHandle());
      const { revokeObjectURL } = mockUrlApis();
      await svc.downloadAs(c, 'test.kmz');
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
    });

    it('revokes object URL even when anchor .click() throws', async () => {
      const c = makeContainer();
      await openWithInjectedHandle(svc, c, makeHandle());
      const { revokeObjectURL } = mockUrlApis();

      const origCreate = document.createElement.bind(document);
      vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
        const el = origCreate(tag);
        if (tag === 'a') {
          Object.defineProperty(el, 'click', {
            value: () => { throw new Error('click blocked'); },
          });
        }
        return el;
      });

      await expect(svc.downloadAs(c, 'test.kmz')).rejects.toBeDefined();
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
    });

    it('wraps container.save() failure in ExportFailedError', async () => {
      const c = makeContainer(new Error('serialization error'));
      await openWithInjectedHandle(svc, c, makeHandle());
      mockUrlApis();
      await expect(svc.downloadAs(c, 'out.kmz')).rejects.toBeInstanceOf(ExportFailedError);
    });

    it('does not change status after successful export', async () => {
      const c = makeContainer();
      await openWithInjectedHandle(svc, c, makeHandle());
      mockUrlApis();
      await svc.downloadAs(c, 'out.kmz');
      expect(svc.status).toBe('saved');
    });
  });

  // ── Byte-pass-through golden test (native write) ───────────────────────────

  describe('Byte-pass-through (golden — native write)', () => {
    it('writes exactly the bytes returned by container.save() without transformation', async () => {
      const data = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0xAA, 0xBB]);
      const buf = data.buffer;
      const c = makeContainer(buf);

      let written: unknown;
      const writable = {
        write: vi.fn().mockImplementation(async (b: unknown) => { written = b; }),
        close: vi.fn().mockResolvedValue(undefined),
        seek: vi.fn(),
        truncate: vi.fn(),
        abort: vi.fn(),
        getWriter: vi.fn(),
        locked: false,
      } as unknown as FileSystemWritableFileStream;

      await openWithInjectedHandle(svc, c, makeHandle(writable));
      svc.notifyChange();
      await svc.save(c);

      expect(written).toBe(buf); // Same reference — no copy/transform.
    });
  });

  // ── Dispose cleanup ───────────────────────────────────────────────────────

  describe('dispose()', () => {
    it('clears all references and resets to idle', async () => {
      const c = makeContainer();
      await openWithInjectedHandle(svc, c, makeHandle());
      svc.dispose();
      expect(svc.status).toBe('idle');
    });

    it('cancels pending debounce timer', async () => {
      const c = makeContainer();
      await openWithInjectedHandle(svc, c, makeHandle(makeWritable()));
      svc.notifyChange();
      svc.dispose();
      await vi.advanceTimersByTimeAsync(1000);
      expect(c.save).not.toHaveBeenCalled();
    });

    it('can be called multiple times without throwing', () => {
      expect(() => {
        svc.dispose();
        svc.dispose();
        svc.dispose();
      }).not.toThrow();
    });

    it('resets all session counters and flags to initial values', async () => {
      const c = makeContainer();
      await openWithInjectedHandle(svc, c, makeHandle());
      svc.notifyChange();
      svc.dispose();
      const s = (svc as any)._session;
      expect(s.isSaving).toBe(false);
      expect(s.pendingFlush).toBe(false);
      expect(s.dirtyVersion).toBe(0);
      expect(s.persistedVersion).toBe(0);
      expect(s.activeContainer).toBeNull();
      expect(s.activeFileHandle).toBeNull();
    });
  });

  // ── createPersistenceService factory ──────────────────────────────────────

  describe('createPersistenceService()', () => {
    it('factory returns a service that satisfies IPersistenceService', async () => {
      const { createPersistenceService } = await import('../src/persistence/index');
      const service = createPersistenceService();
      expect(service.status).toBe('idle');
      expect(typeof service.open).toBe('function');
      expect(typeof service.save).toBe('function');
      expect(typeof service.flush).toBe('function');
      expect(typeof service.notifyChange).toBe('function');
      expect(typeof service.downloadAs).toBe('function');
      expect(typeof service.onStatusChange).toBe('function');
      expect(typeof service.dispose).toBe('function');
      expect(typeof service.hasNativeFileAccess).toBe('boolean');
      service.dispose();
    });

    it('each call returns a fresh independent instance', async () => {
      const { createPersistenceService } = await import('../src/persistence/index');
      const a = createPersistenceService();
      const b = createPersistenceService();
      expect(a).not.toBe(b);
      a.dispose();
      b.dispose();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Error class names and structure
// ─────────────────────────────────────────────────────────────────────────────

describe('Error classes', () => {
  it('UnsupportedEnvironmentError has correct .name', () => {
    expect(new UnsupportedEnvironmentError().name).toBe('UnsupportedEnvironmentError');
  });

  it('ContainerSessionMismatchError has correct .name', () => {
    expect(new ContainerSessionMismatchError().name).toBe('ContainerSessionMismatchError');
  });

  it('NativeHandleMissingError has correct .name', () => {
    expect(new NativeHandleMissingError().name).toBe('NativeHandleMissingError');
  });

  it('NativePermissionDeniedError has correct .name', () => {
    expect(new NativePermissionDeniedError().name).toBe('NativePermissionDeniedError');
  });

  it('NativeWriteFailedError has correct .name', () => {
    expect(new NativeWriteFailedError().name).toBe('NativeWriteFailedError');
  });

  it('ExportFailedError has correct .name', () => {
    expect(new ExportFailedError().name).toBe('ExportFailedError');
  });

  it('all error classes extend Error', () => {
    expect(new UnsupportedEnvironmentError()).toBeInstanceOf(Error);
    expect(new ContainerSessionMismatchError()).toBeInstanceOf(Error);
    expect(new NativeHandleMissingError()).toBeInstanceOf(Error);
    expect(new NativePermissionDeniedError()).toBeInstanceOf(Error);
    expect(new NativeWriteFailedError()).toBeInstanceOf(Error);
    expect(new ExportFailedError()).toBeInstanceOf(Error);
  });

  it('all error classes carry non-empty default messages', () => {
    expect(new UnsupportedEnvironmentError().message).toBeTruthy();
    expect(new ContainerSessionMismatchError().message).toBeTruthy();
    expect(new NativeHandleMissingError().message).toBeTruthy();
    expect(new NativePermissionDeniedError().message).toBeTruthy();
    expect(new NativeWriteFailedError().message).toBeTruthy();
    expect(new ExportFailedError().message).toBeTruthy();
  });

  it('ExportFailedError accepts a custom message', () => {
    expect(new ExportFailedError('custom error').message).toBe('custom error');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// sanitizeFilename
// ─────────────────────────────────────────────────────────────────────────────

describe('sanitizeFilename', () => {
  // ── Fallbacks ──────────────────────────────────────────────────────────────

  it('returns exported.kmz for empty string', () => {
    expect(sanitizeFilename('')).toBe('exported.kmz');
  });

  it('returns exported.kmz for whitespace-only string', () => {
    expect(sanitizeFilename('   ')).toBe('exported.kmz');
  });

  it('returns exported.kmz for a string that is only dots', () => {
    expect(sanitizeFilename('...')).toBe('exported.kmz');
  });

  it('returns exported.kmz for a string that is only slashes', () => {
    expect(sanitizeFilename('///')).toBe('exported.kmz');
  });

  // ── Path traversal stripping ───────────────────────────────────────────────

  it('strips forward-slash path separators (Unix traversal ../../etc/passwd)', () => {
    expect(sanitizeFilename('../../etc/passwd')).toBe('etcpasswd.kmz');
  });

  it('strips backslash path separators (Windows traversal ..\\..\\windows\\system32)', () => {
    expect(sanitizeFilename('..\\..\\windows\\system32')).toBe('windowssystem32.kmz');
  });

  // ── Extension handling ─────────────────────────────────────────────────────

  it('preserves .kml extension', () => {
    expect(sanitizeFilename('mymap.kml')).toBe('mymap.kml');
  });

  it('preserves .kmz extension', () => {
    expect(sanitizeFilename('mymap.kmz')).toBe('mymap.kmz');
  });

  it('preserves .KML extension (case-insensitive check)', () => {
    expect(sanitizeFilename('mymap.KML')).toBe('mymap.KML');
  });

  it('preserves .KMZ extension (case-insensitive check)', () => {
    expect(sanitizeFilename('mymap.KMZ')).toBe('mymap.KMZ');
  });

  it('adds .kmz when no recognized extension present', () => {
    expect(sanitizeFilename('mymap')).toBe('mymap.kmz');
  });

  it('adds .kmz when extension is an unrecognized type (.txt)', () => {
    expect(sanitizeFilename('mymap.txt')).toBe('mymap.txt.kmz');
  });

  it('does NOT strip mid-name dots (extension dot preserved)', () => {
    expect(sanitizeFilename('version.1.2.kmz')).toBe('version.1.2.kmz');
  });

  // ── Forbidden character stripping ─────────────────────────────────────────

  it('strips Windows forbidden characters (* ? " < > | :)', () => {
    expect(sanitizeFilename('file*name?.kmz')).toBe('filename.kmz');
  });

  it('strips colon characters', () => {
    expect(sanitizeFilename('C:drive.kmz')).toBe('Cdrive.kmz');
  });

  it('strips null bytes', () => {
    expect(sanitizeFilename('file\x00name.kmz')).toBe('filename.kmz');
  });

  it('strips carriage-return and newline characters', () => {
    expect(sanitizeFilename('file\r\nname.kmz')).toBe('filename.kmz');
  });

  // ── Whitespace normalisation ───────────────────────────────────────────────

  it('normalizes multiple spaces to a single space', () => {
    expect(sanitizeFilename('my   file.kmz')).toBe('my file.kmz');
  });

  it('trims leading and trailing spaces', () => {
    expect(sanitizeFilename('  mymap.kmz  ')).toBe('mymap.kmz');
  });

  // ── Unicode / international characters ────────────────────────────────────

  it('keeps valid Unicode in names', () => {
    expect(sanitizeFilename('Straße_München.kmz')).toBe('Straße_München.kmz');
  });

  it('keeps emoji in names', () => {
    expect(sanitizeFilename('my🗺️map.kmz')).toBe('my🗺️map.kmz');
  });

  it('does not truncate very long filenames', () => {
    const long = 'a'.repeat(200) + '.kmz';
    expect(sanitizeFilename(long)).toBe(long);
  });
});
