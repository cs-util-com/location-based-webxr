import { IKmzContainer } from '../contracts/kmz-container';
import { IPersistenceService, SaveStatus } from '../contracts/persistence';
import {
  ContainerSessionMismatchError,
  ExportFailedError,
  NativeHandleMissingError,
  NativePermissionDeniedError,
  NativeWriteFailedError,
  UnsupportedEnvironmentError,
} from './errors';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Default debounce window in milliseconds. */
const DEBOUNCE_MS = 600;

/** Warn when a save buffer exceeds this many bytes (100 MB). */
const WARN_BYTES = 100 * 1024 * 1024;

/** Hard-fail when a save buffer exceeds this many bytes (300 MB). */
const MAX_BYTES = 300 * 1024 * 1024;

// ─────────────────────────────────────────────────────────────────────────────
// Internal state
// ─────────────────────────────────────────────────────────────────────────────

interface SessionState {
  /** Incremented on every open() and dispose(). Guards stale async completions. */
  sessionToken: number;
  activeContainer: IKmzContainer | null;
  activeFileHandle: FileSystemFileHandle | null;
  fileName: string;
  opfsFileName: string;
  mode: 'native' | 'opfs' | 'detached';
  opfsFallbackEnabled: boolean;
  /** Incremented by notifyChange(). */
  dirtyVersion: number;
  /** Set to dirtyVersion snapshot after a successful write close(). */
  persistedVersion: number;
  /** True while a write is in-flight. */
  isSaving: boolean;
  /** True when flush() is waiting for an in-flight save to finish. */
  pendingFlush: boolean;
  timerId: ReturnType<typeof setTimeout> | null;
  status: SaveStatus;
  lastError: Error | null;
}

function initialSession(): SessionState {
  return {
    sessionToken: 0,
    activeContainer: null,
    activeFileHandle: null,
    fileName: 'document.kmz',
    opfsFileName: 'opfs-working-copy.kmz',
    mode: 'detached',
    opfsFallbackEnabled: true,
    dirtyVersion: 0,
    persistedVersion: 0,
    isSaving: false,
    pendingFlush: false,
    timerId: null,
    status: 'idle',
    lastError: null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function isChrome(): boolean {
  if (typeof navigator === 'undefined') return false;
  // Detect Chromium-family browsers via userAgentData where available.
  const uaData = (navigator as any).userAgentData;
  if (uaData && Array.isArray(uaData.brands)) {
    return uaData.brands.some(
      (b: { brand: string }) =>
        b.brand === 'Google Chrome' || b.brand === 'Chromium',
    );
  }
  // Legacy user-agent fallback: Chrome but not Edge.
  const ua = navigator.userAgent;
  return /Chrome\//.test(ua) && !/Edg\//.test(ua);
}

function hasFileSystemAccess(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof (window as any).showOpenFilePicker === 'function'
  );
}

/** In-memory fallback cache for environments without OPFS API support */
const opfsInMemoryMap = new Map<string, ArrayBuffer>();

/**
 * Sanitize a suggested download filename.
 * - Strip path separators and null bytes.
 * - Normalize whitespace.
 * - Fall back to "exported.kmz" when blank.
 * - Enforce .kml or .kmz extension; default to .kmz.
 */
export function sanitizeFilename(name: string): string {
  // 1. Strip path separators so traversal segments become individual tokens.
  let n = name.replace(/[/\\]/g, '');
  // 2. Strip other Windows-forbidden / shell-dangerous characters and control bytes.
  n = n.replace(/[:*?"<>|\x00-\x1f]/g, '');
  // 3. Strip any sequence of leading dots (traversal fragments like '..' become empty).
  n = n.replace(/^\.+/, '');
  // 4. Normalize whitespace sequences to a single space.
  n = n.replace(/\s+/g, ' ').trim();
  if (!n) return 'exported.kmz';
  // 5. Enforce recognized extension.
  const lower = n.toLowerCase();
  if (!lower.endsWith('.kml') && !lower.endsWith('.kmz')) {
    n = n + '.kmz';
  }
  return n;
}

function isPermissionError(err: unknown): boolean {
  if (err instanceof DOMException) {
    return err.name === 'NotAllowedError' || err.name === 'SecurityError';
  }
  return false;
}

function classifyWriteError(err: unknown): Error {
  if (isPermissionError(err)) return new NativePermissionDeniedError(err);
  return new NativeWriteFailedError(err);
}

// ─────────────────────────────────────────────────────────────────────────────
// PersistenceServiceImpl
// ─────────────────────────────────────────────────────────────────────────────

export class PersistenceServiceImpl implements IPersistenceService {
  private _session: SessionState = initialSession();
  private _listeners: Set<(status: SaveStatus) => void> = new Set();

  /** Configure whether OPFS fallback is active when native file handle is absent or denied. */
  get opfsFallbackEnabled(): boolean {
    return this._session.opfsFallbackEnabled;
  }
  set opfsFallbackEnabled(enabled: boolean) {
    this._session.opfsFallbackEnabled = enabled;
  }

  /** Current operational persistence mode. */
  get mode(): 'native' | 'opfs' | 'detached' {
    return this._session.mode;
  }

  /** True if there are unsaved changes pending write/flush. */
  get hasUnsavedChanges(): boolean {
    return this._session.dirtyVersion > this._session.persistedVersion;
  }

  /** Name of the active file session. */
  get fileName(): string {
    return this._session.fileName;
  }

  // ── IPersistenceService: status ───────────────────────────────────────────

  get status(): SaveStatus {
    return this._session.status;
  }

  get hasNativeFileAccess(): boolean {
    return isChrome() && hasFileSystemAccess();
  }

  onStatusChange(listener: (status: SaveStatus) => void): () => void {
    this._listeners.add(listener);
    return () => {
      this._listeners.delete(listener);
    };
  }

  // ── IPersistenceService: open ─────────────────────────────────────────────

  async open(file?: File): Promise<IKmzContainer> {
    // Tear down any existing session.
    this._teardown();

    let container: IKmzContainer;
    let fileHandle: FileSystemFileHandle | null = null;
    let name = 'document.kmz';
    let mode: 'native' | 'opfs' | 'detached' = 'detached';

    if (!file) {
      // ── Picker path ───────────────────────────────────────────────────────
      if (!isChrome() || !hasFileSystemAccess()) {
        const err = new UnsupportedEnvironmentError(
          'showOpenFilePicker is not available in this environment.',
        );
        this._setStatus('error', err);
        throw err;
      }

      let handle: FileSystemFileHandle;
      try {
        const [pickedHandle] = await (window as any).showOpenFilePicker({
          types: [
            {
              description: 'KML & KMZ Files (*.kmz, *.kml)',
              accept: {
                'application/vnd.google-earth.kmz': ['.kmz', '.KMZ'],
                'application/vnd.google-earth.kml+xml': ['.kml', '.KML'],
                'application/xml': ['.kml', '.KML'],
                'application/zip': ['.kmz', '.KMZ'],
              },
            },
          ],
          multiple: false,
        });
        handle = pickedHandle;
      } catch (err: any) {
        if (err?.name === 'AbortError') {
          this._setStatus('idle');
          throw err;
        }
        throw err;
      }

      name = handle.name || 'document.kmz';

      // Check and request readwrite permission.
      let perm = 'granted';
      try {
        const h = handle as any;
        if (typeof h.requestPermission === 'function') {
          perm = await h.requestPermission({ mode: 'readwrite' });
        } else if (typeof h.queryPermission === 'function') {
          perm = await h.queryPermission({ mode: 'readwrite' });
        }
      } catch (_) {
        perm = 'denied';
      }

      if (perm !== 'granted') {
        const err = new NativePermissionDeniedError();
        this._setStatus('error', err);
        throw err;
      }

      const pickedFile: File = await handle.getFile();
      container = await this._openContainer(pickedFile);
      fileHandle = handle;
      mode = 'native';
    } else {
      // ── Detached / External File provided ─────────────────────────
      name = file.name || 'document.kmz';
      const opfsName = 'opfs-working-copy-' + sanitizeFilename(name);

      // Check if an OPFS working copy exists for this file
      const opfsBytes = await this._readFromOpfs(opfsName);
      if (opfsBytes && opfsBytes.byteLength > 0) {
        const workingFile = new File([opfsBytes], name, { type: file.type });
        container = await this._openContainer(workingFile);
      } else {
        container = await this._openContainer(file);
      }
      fileHandle = null;
      mode = this._session.opfsFallbackEnabled ? 'opfs' : 'detached';
    }

    const opfsName = 'opfs-working-copy-' + sanitizeFilename(name);

    // Bind new session.
    const s = this._session;
    s.sessionToken++;
    s.activeContainer = container;
    s.activeFileHandle = fileHandle;
    s.fileName = name;
    s.opfsFileName = opfsName;
    s.mode = mode;
    s.dirtyVersion = 0;
    s.persistedVersion = 0;
    s.isSaving = false;
    s.pendingFlush = false;
    s.lastError = null;
    this._setStatus('saved');

    return container;
  }

  // ── IPersistenceService: notifyChange ─────────────────────────────────────

  notifyChange(): void {
    const s = this._session;
    if (!s.activeContainer) {
      // Diagnostic only; do not throw.
      console.warn('[persistence] notifyChange called with no active session.');
      return;
    }
    s.dirtyVersion++;
    this._resetDebounceTimer(s.sessionToken);
  }

  // ── IPersistenceService: save ─────────────────────────────────────────────

  async save(container: IKmzContainer): Promise<void> {
    this._assertContainerIdentity(container);
    const s = this._session;
    this._clearTimer();
    await this._attemptSave('manual', s.sessionToken);
  }

  // ── IPersistenceService: flush ────────────────────────────────────────────

  async flush(container: IKmzContainer): Promise<void> {
    this._assertContainerIdentity(container);
    const s = this._session;
    this._clearTimer();

    if (s.isSaving) {
      s.pendingFlush = true;
      // Wait for the current in-flight save to finish by polling status change.
      await this._waitForSaveDone();
    }

    const token = s.sessionToken;
    if (s.dirtyVersion > s.persistedVersion) {
      await this._attemptSave('flush', token);
    }

    // If another dirty came in while we were saving, do exactly one more.
    if (s.pendingFlush && s.dirtyVersion > s.persistedVersion && token === s.sessionToken) {
      s.pendingFlush = false;
      await this._attemptSave('flush-followup', token);
    }
    s.pendingFlush = false;
  }

  // ── IPersistenceService: downloadAs ──────────────────────────────────────

  async downloadAs(container: IKmzContainer, filename: string): Promise<void> {
    this._assertContainerIdentity(container);

    let bytes: ArrayBuffer;
    try {
      bytes = await container.save();
    } catch (err) {
      throw new ExportFailedError(`container.save() threw during export: ${err}`);
    }

    const safe = sanitizeFilename(filename);
    let url: string | null = null;
    try {
      const blob = new Blob([bytes], { type: 'application/octet-stream' });
      url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = safe;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } finally {
      if (url) URL.revokeObjectURL(url);
    }
    // Intentionally: do NOT update persistedVersion. Export ≠ native save.
  }

  // ── IPersistenceService: dispose ──────────────────────────────────────────

  dispose(): void {
    this._teardown();
  }

  // ── OPFS Helpers ──────────────────────────────────────────────────────────

  /** Write bytes atomically to OPFS working copy (temp file -> swap). */
  private async _writeToOpfs(filename: string, bytes: ArrayBuffer): Promise<void> {
    opfsInMemoryMap.set(filename, bytes.slice(0));

    if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) {
      return;
    }
    try {
      const root = await navigator.storage.getDirectory();
      const tempName = `${filename}.tmp`;
      const tempHandle = await root.getFileHandle(tempName, { create: true });
      const writable = await tempHandle.createWritable();
      await writable.write(bytes);
      await writable.close();

      const targetHandle = await root.getFileHandle(filename, { create: true });
      const targetWritable = await targetHandle.createWritable();
      await targetWritable.write(bytes);
      await targetWritable.close();

      try {
        await root.removeEntry(tempName);
      } catch (_) { /* ignore temp cleanup errors */ }
    } catch (err) {
      console.warn('[persistence] OPFS fallback write failed:', err);
    }
  }

  /** Read bytes from OPFS working copy or in-memory map. */
  private async _readFromOpfs(filename: string): Promise<ArrayBuffer | null> {
    if (typeof navigator !== 'undefined' && navigator.storage?.getDirectory) {
      try {
        const root = await navigator.storage.getDirectory();
        const handle = await root.getFileHandle(filename);
        const file = await handle.getFile();
        return await file.arrayBuffer();
      } catch (_) {
        // Fall through to memory map
      }
    }
    return opfsInMemoryMap.get(filename) ?? null;
  }

  // ── Internal helpers ──────────────────────────────────────────────────────

  /** Open an IKmzContainer from a File. Dynamically imports kmz-io to avoid hard coupling. */
  private async _openContainer(file: File): Promise<IKmzContainer> {
    const { KmzContainer } = await import('../kmz-io/container');
    const container = new KmzContainer();
    await container.open(file);
    return container;
  }

  private _setStatus(status: SaveStatus, err?: Error): void {
    this._session.status = status;
    if (err) this._session.lastError = err;
    for (const fn of this._listeners) {
      try { fn(status); } catch (_) { /* listener errors must not crash service */ }
    }
  }

  private _assertContainerIdentity(container: IKmzContainer): void {
    if (container !== this._session.activeContainer) {
      throw new ContainerSessionMismatchError();
    }
  }

  private _clearTimer(): void {
    const s = this._session;
    if (s.timerId !== null) {
      clearTimeout(s.timerId);
      s.timerId = null;
    }
  }

  private _resetDebounceTimer(tokenSnapshot: number): void {
    this._clearTimer();
    this._session.timerId = setTimeout(() => {
      this._session.timerId = null;
      this._attemptSave('autosave', tokenSnapshot).catch(() => {
        // Status was already set to error inside _attemptSave.
      });
    }, DEBOUNCE_MS);
  }

  /** Resolve when isSaving becomes false (uses a small poll via status listeners). */
  private _waitForSaveDone(): Promise<void> {
    return new Promise<void>((resolve) => {
      if (!this._session.isSaving) {
        resolve();
        return;
      }
      let unsubscribe: (() => void) | null = null;
      const check = () => {
        if (!this._session.isSaving) {
          if (unsubscribe) { unsubscribe(); unsubscribe = null; }
          resolve();
        }
      };
      unsubscribe = this.onStatusChange(check);
    });
  }

  /**
   * Core write path. Always:
   * 1. Guards stale session token.
   * 2. Handles permission checking/re-requesting or OPFS fallback.
   * 3. Serializes container bytes.
   * 4. Writes atomically (native createWritable swap-on-close or OPFS temp->swap).
   * 5. Updates persistedVersion only after successful close().
   */
  private async _attemptSave(
    _mode: 'autosave' | 'manual' | 'flush' | 'flush-followup',
    tokenSnapshot: number,
  ): Promise<void> {
    const s = this._session;

    // Guard: stale token.
    if (tokenSnapshot !== s.sessionToken) return;

    // Guard: already saving.
    if (s.isSaving) return;

    // Guard: no native handle when OPFS fallback is disabled.
    if (!s.activeFileHandle && !s.opfsFallbackEnabled) {
      const err = new NativeHandleMissingError();
      s.lastError = err;
      this._setStatus('error', err);
      throw err;
    }

    s.isSaving = true;
    this._setStatus('saving');

    const dirtySnapshot = s.dirtyVersion;

    let bytes: ArrayBuffer;
    try {
      bytes = await s.activeContainer!.save();
    } catch (err) {
      if (tokenSnapshot !== s.sessionToken) return; // stale: ignore
      s.isSaving = false;
      const wrapped = new NativeWriteFailedError(err);
      this._setStatus('error', wrapped);
      throw wrapped;
    }

    // Check token after each await.
    if (tokenSnapshot !== s.sessionToken) return;

    // Large-file guardrails.
    if (bytes.byteLength > MAX_BYTES) {
      s.isSaving = false;
      const err = new NativeWriteFailedError(
        `File is too large to save safely (${bytes.byteLength} bytes > ${MAX_BYTES} limit).`,
      );
      this._setStatus('error', err);
      throw err;
    }
    if (bytes.byteLength > WARN_BYTES) {
      console.warn(
        `[persistence] Large file: ${bytes.byteLength} bytes. Save may be slow.`,
      );
    }

    if (s.activeFileHandle) {
      // Re-verify permission on write if queryPermission is available
      let perm = 'granted';
      try {
        const h = s.activeFileHandle as any;
        if (typeof h.queryPermission === 'function') {
          perm = await h.queryPermission({ mode: 'readwrite' });
        }
      } catch (_) {
        perm = 'granted'; // Fall through to createWritable which will throw DOMException if denied
      }

      if (perm === 'denied') {
        s.isSaving = false;
        const err = new NativePermissionDeniedError();
        this._setStatus('error', err);
        throw err;
      }

      let writable: FileSystemWritableFileStream | null = null;
      try {
        writable = await s.activeFileHandle.createWritable();
        await writable.write(bytes);
        await writable.close();
        s.mode = 'native';
        // Also back up to OPFS working copy
        await this._writeToOpfs(s.opfsFileName, bytes);
      } catch (err) {
        if (tokenSnapshot !== s.sessionToken) return;
        s.isSaving = false;
        if (writable) {
          try { await writable.abort(); } catch (_) { /* ignore abort failure */ }
        }
        const wrapped = classifyWriteError(err);
        this._setStatus('error', wrapped);
        throw wrapped;
      }
    } else {
      // Fallback: OPFS Working Copy atomic save
      await this._writeToOpfs(s.opfsFileName, bytes);
      s.mode = 'opfs';
    }

    // ── Commit point ──────────────────────────────────────────────────────
    if (tokenSnapshot !== s.sessionToken) return; // stale: ignore success

    s.isSaving = false;
    s.persistedVersion = dirtySnapshot;

    if (s.dirtyVersion > s.persistedVersion) {
      // New changes arrived while we were saving; schedule one follow-up.
      this._setStatus('saving');
      this._resetDebounceTimer(s.sessionToken);
    } else {
      this._setStatus('saved');
    }
  }

  /** Increment token, clear timer and in-flight state, drop references. */
  private _teardown(): void {
    const s = this._session;
    s.sessionToken++;
    this._clearTimer();
    s.activeContainer = null;
    s.activeFileHandle = null;
    s.fileName = 'document.kmz';
    s.opfsFileName = 'opfs-working-copy.kmz';
    s.mode = 'detached';
    s.isSaving = false;
    s.pendingFlush = false;
    s.lastError = null;
    s.dirtyVersion = 0;
    s.persistedVersion = 0;
    this._setStatus('idle');
  }
}

