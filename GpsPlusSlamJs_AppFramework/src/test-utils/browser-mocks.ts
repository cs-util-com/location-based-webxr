/**
 * Browser API Mocks for Testing
 *
 * Provides mock implementations for browser APIs that aren't available in Node.js:
 * - WebXR (navigator.xr, XRSession, XRFrame, XRViewerPose)
 * - Geolocation (navigator.geolocation)
 * - Device Orientation (DeviceOrientationEvent)
 * - File System Access API (showDirectoryPicker, FileSystemDirectoryHandle)
 *
 * @see browser-mocks.md for usage examples
 */

import { vi, type Mock } from 'vitest';
import type { WebXRQuaternion, WebXRVec3 } from '../types/ar-types';

// ============================================================================
// WebXR Mocks
// ============================================================================

export interface MockXRViewerPose {
  views: MockXRView[];
  transform?: {
    matrix: Float32Array;
    position: DOMPointReadOnly;
    orientation: DOMPointReadOnly;
    inverse: XRRigidTransform | null;
  };
  emulatedPosition?: boolean;
}

export interface MockXRView {
  transform: {
    position: { x: number; y: number; z: number; w: number };
    orientation: WebXRQuaternion;
  };
}

export interface MockXRFrame {
  getViewerPose: Mock<(space: unknown) => MockXRViewerPose | null>;
  getDepthInformation?: Mock<(view: unknown) => MockDepthInfo | null>;
}

export interface MockDepthInfo {
  width: number;
  height: number;
  getDepthInMeters: (x: number, y: number) => number;
}

export interface MockXRSession {
  addEventListener: Mock;
  removeEventListener: Mock;
  end: Mock<() => Promise<void>>;
  requestReferenceSpace: Mock<(type: string) => Promise<unknown>>;
}

export interface MockXR {
  isSessionSupported: Mock<(mode: string) => Promise<boolean>>;
  requestSession: Mock<
    (mode: string, options?: unknown) => Promise<MockXRSession>
  >;
}

/**
 * Create a mock XRViewerPose with specified position and orientation.
 */
export function createMockPose(
  position: WebXRVec3,
  orientation: WebXRQuaternion
): MockXRViewerPose {
  const viewTransform = {
    position: { ...position, w: 1 },
    orientation: { ...orientation },
  };
  return {
    views: [
      {
        transform: viewTransform,
      },
    ],
    // XRViewerPose also has transform and emulatedPosition properties
    transform: {
      matrix: new Float32Array(16),
      position: viewTransform.position as unknown as DOMPointReadOnly,
      orientation: viewTransform.orientation as unknown as DOMPointReadOnly,
      inverse: null,
    },
    emulatedPosition: false,
  };
}

/**
 * Create a mock XRFrame that returns the specified pose.
 */
export function createMockFrame(pose: MockXRViewerPose | null): MockXRFrame {
  return {
    getViewerPose: vi.fn(() => pose),
    getDepthInformation: vi.fn(() => null),
  };
}

/**
 * Create a mock depth info object with configurable depth function.
 */
export function createMockDepthInfo(
  depthFn: (x: number, y: number) => number = () => 1.5
): MockDepthInfo {
  return {
    width: 256,
    height: 256,
    getDepthInMeters: depthFn,
  };
}

/**
 * Create a mock XRSession.
 */
export function createMockXRSession(): MockXRSession {
  const listeners: Map<string, Set<EventListener>> = new Map();

  return {
    addEventListener: vi.fn((type: string, listener: EventListener) => {
      if (!listeners.has(type)) {
        listeners.set(type, new Set());
      }
      listeners.get(type)!.add(listener);
    }),
    removeEventListener: vi.fn((type: string, listener: EventListener) => {
      listeners.get(type)?.delete(listener);
    }),
    end: vi.fn(() => Promise.resolve()),
    requestReferenceSpace: vi.fn(() => Promise.resolve({})),
  };
}

/**
 * Create a mock navigator.xr object.
 */
export function createMockXR(supported = true): MockXR {
  const session = createMockXRSession();
  return {
    isSessionSupported: vi.fn(() => Promise.resolve(supported)),
    requestSession: vi.fn(() => Promise.resolve(session)),
  };
}

/**
 * Install WebXR mocks on the global navigator object.
 * Returns cleanup function.
 */
export function installWebXRMocks(supported = true): () => void {
  const mockXR = createMockXR(supported);
  const existingNavigator = typeof navigator !== 'undefined' ? navigator : {};
  vi.stubGlobal('navigator', { ...existingNavigator, xr: mockXR });
  return () => vi.unstubAllGlobals();
}

// ============================================================================
// Geolocation Mocks
// ============================================================================

export interface MockGeolocationPosition {
  coords: {
    latitude: number;
    longitude: number;
    altitude: number | null;
    accuracy: number;
    altitudeAccuracy: number | null;
    heading: number | null;
    speed: number | null;
    toJSON: () => GeolocationCoordinates;
  };
  timestamp: number;
  toJSON: () => GeolocationPosition;
}

export interface MockGeolocation {
  watchPosition: Mock<
    (
      success: PositionCallback,
      error?: PositionErrorCallback | null,
      options?: PositionOptions
    ) => number
  >;
  clearWatch: Mock<(id: number) => void>;
  getCurrentPosition: Mock<
    (
      success: PositionCallback,
      error?: PositionErrorCallback | null,
      options?: PositionOptions
    ) => void
  >;
}

/**
 * Create a mock geolocation position.
 */
export function createMockGeoPosition(
  lat: number,
  lon: number,
  altitude: number | null = null,
  accuracy = 10
): MockGeolocationPosition {
  const coordsData = {
    latitude: lat,
    longitude: lon,
    altitude,
    accuracy,
    altitudeAccuracy: altitude !== null ? 5 : null,
    heading: null,
    speed: null,
  };

  const coords: MockGeolocationPosition['coords'] = {
    ...coordsData,
    toJSON: () => ({ ...coordsData }) as GeolocationCoordinates,
  };

  const timestamp = Date.now();

  const position: MockGeolocationPosition = {
    coords,
    timestamp,
    toJSON: () =>
      ({
        coords: { ...coordsData } as GeolocationCoordinates,
        timestamp,
      }) as GeolocationPosition,
  };

  return position;
}

/**
 * Create a mock geolocation object.
 */
export function createMockGeolocation(): MockGeolocation {
  let watchId = 0;
  const watchers = new Map<number, PositionCallback>();

  const mock: MockGeolocation = {
    watchPosition: vi.fn((success, _error, _options) => {
      const id = ++watchId;
      watchers.set(id, success);
      return id;
    }),
    clearWatch: vi.fn((id) => {
      watchers.delete(id);
    }),
    getCurrentPosition: vi.fn((success, _error, _options) => {
      success(createMockGeoPosition(50.0, 8.0));
    }),
  };

  // Expose helper to simulate position updates
  const mockWithHelpers = mock as MockGeolocation & {
    simulatePosition: (pos: MockGeolocationPosition) => void;
  };
  mockWithHelpers.simulatePosition = (pos: MockGeolocationPosition) => {
    for (const callback of watchers.values()) {
      callback(pos);
    }
  };

  return mock;
}

/**
 * Install geolocation mocks on the global navigator object.
 * Returns cleanup function.
 */
export function installGeolocationMocks(): () => void {
  const mockGeo = createMockGeolocation();
  const existingNavigator = typeof navigator !== 'undefined' ? navigator : {};
  vi.stubGlobal('navigator', { ...existingNavigator, geolocation: mockGeo });
  return () => vi.unstubAllGlobals();
}

// ============================================================================
// Device Orientation Mocks
// ============================================================================

export interface MockDeviceOrientationEvent {
  alpha: number | null;
  beta: number | null;
  gamma: number | null;
  absolute: boolean;
}

/**
 * Create a mock DeviceOrientationEvent.
 */
export function createMockOrientationEvent(
  alpha: number,
  beta: number,
  gamma: number,
  absolute = false
): MockDeviceOrientationEvent {
  return { alpha, beta, gamma, absolute };
}

/**
 * Create a mock DeviceOrientationEvent class with requestPermission support.
 */
export function createMockDeviceOrientationEventClass(
  permissionGranted = true
): typeof DeviceOrientationEvent & {
  requestPermission?: () => Promise<'granted' | 'denied'>;
} {
  const MockClass = class MockDeviceOrientationEvent {
    alpha: number | null;
    beta: number | null;
    gamma: number | null;
    absolute: boolean;

    constructor(type: string, init?: MockDeviceOrientationEvent) {
      this.alpha = init?.alpha ?? null;
      this.beta = init?.beta ?? null;
      this.gamma = init?.gamma ?? null;
      this.absolute = init?.absolute ?? false;
    }

    static requestPermission = vi.fn(() =>
      Promise.resolve(permissionGranted ? 'granted' : 'denied')
    );
  };

  return MockClass as unknown as typeof DeviceOrientationEvent & {
    requestPermission: () => Promise<'granted' | 'denied'>;
  };
}

// ============================================================================
// File System Access API Mocks
// ============================================================================

export interface MockFileSystemFileHandle {
  kind: 'file';
  name: string;
  getFile: Mock<() => Promise<File>>;
  createWritable: Mock<() => Promise<MockFileSystemWritableFileStream>>;
}

export interface MockFileSystemWritableFileStream {
  write: Mock<(data: unknown) => Promise<void>>;
  close: Mock<() => Promise<void>>;
}

export interface MockFileSystemDirectoryHandle {
  kind: 'directory';
  name: string;
  entries: Mock<
    () => AsyncIterable<
      [string, MockFileSystemFileHandle | MockFileSystemDirectoryHandle]
    >
  >;
  getFileHandle: Mock<
    (
      name: string,
      options?: { create?: boolean }
    ) => Promise<MockFileSystemFileHandle>
  >;
  getDirectoryHandle: Mock<
    (
      name: string,
      options?: { create?: boolean }
    ) => Promise<MockFileSystemDirectoryHandle>
  >;
  removeEntry: Mock<
    (name: string, options?: { recursive?: boolean }) => Promise<void>
  >;
}

/**
 * Create a mock file handle.
 */
export function createMockFileHandle(
  name: string,
  content = ''
): MockFileSystemFileHandle {
  const file = new File([content], name, { type: 'application/json' });

  const writable: MockFileSystemWritableFileStream = {
    write: vi.fn(() => Promise.resolve()),
    close: vi.fn(() => Promise.resolve()),
  };

  return {
    kind: 'file',
    name,
    getFile: vi.fn(() => Promise.resolve(file)),
    createWritable: vi.fn(() => Promise.resolve(writable)),
  };
}

/**
 * Create a mock directory handle with specified files.
 */
export function createMockDirectoryHandle(
  name: string,
  files: Map<string, string> = new Map(),
  subdirs: Map<string, MockFileSystemDirectoryHandle> = new Map()
): MockFileSystemDirectoryHandle {
  const handle: MockFileSystemDirectoryHandle = {
    kind: 'directory',
    name,
    entries: vi.fn(function* () {
      for (const [fileName, content] of files) {
        yield [fileName, createMockFileHandle(fileName, content)] as const;
      }
      for (const [dirName, dirHandle] of subdirs) {
        yield [dirName, dirHandle] as const;
      }
    }) as unknown as Mock<
      () => AsyncIterable<
        [string, MockFileSystemFileHandle | MockFileSystemDirectoryHandle]
      >
    >,
    getFileHandle: vi.fn((fileName: string, options?: { create?: boolean }) => {
      if (files.has(fileName)) {
        return Promise.resolve(
          createMockFileHandle(fileName, files.get(fileName))
        );
      }
      if (options?.create) {
        files.set(fileName, '');
        return Promise.resolve(createMockFileHandle(fileName, ''));
      }
      return Promise.reject(
        new DOMException(`File ${fileName} not found`, 'NotFoundError')
      );
    }),
    getDirectoryHandle: vi.fn(
      (dirName: string, options?: { create?: boolean }) => {
        if (subdirs.has(dirName)) {
          return Promise.resolve(subdirs.get(dirName)!);
        }
        if (options?.create) {
          const newDir = createMockDirectoryHandle(dirName);
          subdirs.set(dirName, newDir);
          return Promise.resolve(newDir);
        }
        return Promise.reject(
          new DOMException(`Directory ${dirName} not found`, 'NotFoundError')
        );
      }
    ),
    removeEntry: vi.fn((entryName: string) => {
      files.delete(entryName);
      subdirs.delete(entryName);
      return Promise.resolve();
    }),
  };

  return handle;
}

// ============================================================================
// Class-Based File System Mocks (for tests requiring addFile/addDirectory)
// ============================================================================

/**
 * Class-based mock FileSystemFileHandle for tests requiring mutable state.
 * Use this when you need to modify file contents during tests.
 */
export class MockFSFileHandle implements FileSystemFileHandle {
  kind = 'file' as const;
  name: string;
  private content: string | Uint8Array;

  constructor(name: string, content: string | Uint8Array = '') {
    this.name = name;
    this.content = content;
  }

  getFile(): Promise<File> {
    const type = this.name.endsWith('.zip')
      ? 'application/zip'
      : 'application/json';
    // Convert Uint8Array to ArrayBuffer for BlobPart compatibility
    const blobPart: BlobPart =
      typeof this.content === 'string'
        ? this.content
        : (this.content.buffer as ArrayBuffer);
    return Promise.resolve(new File([blobPart], this.name, { type }));
  }

  createWritable(): Promise<FileSystemWritableFileStream> {
    const writable = {
      write: vi.fn((data: string) => {
        this.content = data;
        return Promise.resolve();
      }),
      close: vi.fn(() => Promise.resolve()),
    } as unknown as FileSystemWritableFileStream;
    return Promise.resolve(writable);
  }

  createSyncAccessHandle(): Promise<unknown> {
    throw new Error('Not implemented');
  }

  isSameEntry(): Promise<boolean> {
    throw new Error('Not implemented');
  }
}

/**
 * Class-based mock FileSystemDirectoryHandle for tests requiring addFile/addDirectory.
 * Implements the full FileSystemDirectoryHandle interface.
 */
export class MockFSDirectoryHandle implements FileSystemDirectoryHandle {
  kind = 'directory' as const;
  name: string;
  private contents = new Map<
    string,
    FileSystemDirectoryHandle | FileSystemFileHandle
  >();

  constructor(name: string) {
    this.name = name;
  }

  /**
   * Add a file to this directory.
   * Accepts string content (for JSON etc) or Uint8Array (for zip bytes).
   */
  addFile(name: string, content: string | Uint8Array): void {
    this.contents.set(name, new MockFSFileHandle(name, content));
  }

  /**
   * Add a subdirectory to this directory.
   */
  addDirectory(name: string, handle: FileSystemDirectoryHandle): void {
    this.contents.set(name, handle);
  }

  async *entries() {
    await Promise.resolve(); // Satisfy eslint require-await
    for (const entry of this.contents) {
      yield entry;
    }
    return undefined;
  }

  // Async iterator for for-await-of
  async *[Symbol.asyncIterator]() {
    // Use await to satisfy eslint require-await for async generators
    await Promise.resolve();
    for (const entry of this.contents) {
      yield entry;
    }
    return undefined;
  }

  getDirectoryHandle(
    name: string,
    options?: { create?: boolean }
  ): Promise<FileSystemDirectoryHandle> {
    const handle = this.contents.get(name);
    if (handle && handle.kind === 'directory') {
      return Promise.resolve(handle);
    }
    if (options?.create) {
      const newHandle = new MockFSDirectoryHandle(name);
      this.contents.set(name, newHandle);
      return Promise.resolve(newHandle);
    }
    return Promise.reject(
      new DOMException(`Directory ${name} not found`, 'NotFoundError')
    );
  }

  getFileHandle(
    name: string,
    options?: { create?: boolean }
  ): Promise<FileSystemFileHandle> {
    const handle = this.contents.get(name);
    if (handle && handle.kind === 'file') {
      return Promise.resolve(handle);
    }
    if (options?.create) {
      const newHandle = new MockFSFileHandle(name, '');
      this.contents.set(name, newHandle);
      return Promise.resolve(newHandle);
    }
    return Promise.reject(
      new DOMException(`File ${name} not found`, 'NotFoundError')
    );
  }

  removeEntry(name: string): Promise<void> {
    this.contents.delete(name);
    return Promise.resolve();
  }

  resolve(): Promise<string[] | null> {
    throw new Error('Not implemented');
  }

  isSameEntry(): Promise<boolean> {
    throw new Error('Not implemented');
  }

  async *values() {
    await Promise.resolve(); // Satisfy eslint require-await
    for (const handle of this.contents.values()) {
      yield handle;
    }
    return undefined;
  }

  async *keys() {
    await Promise.resolve(); // Satisfy eslint require-await
    for (const name of this.contents.keys()) {
      yield name;
    }
    return undefined;
  }

  queryPermission(_descriptor?: {
    mode?: 'read' | 'readwrite';
  }): Promise<PermissionState> {
    return Promise.resolve('granted');
  }

  requestPermission(_descriptor?: {
    mode?: 'read' | 'readwrite';
  }): Promise<PermissionState> {
    return Promise.resolve('granted');
  }
}

/**
 * Install File System Access API mocks on the global window object.
 * Returns cleanup function.
 */
export function installFileSystemMocks(
  rootDir?: MockFileSystemDirectoryHandle
): () => void {
  const mockRoot = rootDir ?? createMockDirectoryHandle('root');
  const showDirectoryPicker = vi.fn(() => Promise.resolve(mockRoot));

  vi.stubGlobal('showDirectoryPicker', showDirectoryPicker);

  return () => vi.unstubAllGlobals();
}

// ============================================================================
// Combined Setup
// ============================================================================

/**
 * Install all browser mocks at once.
 * Returns cleanup function.
 */
export function installAllBrowserMocks(options?: {
  webxrSupported?: boolean;
  geolocation?: boolean;
  fileSystem?: boolean;
  rootDir?: MockFileSystemDirectoryHandle;
}): () => void {
  const cleanups: Array<() => void> = [];

  if (options?.webxrSupported !== false) {
    cleanups.push(installWebXRMocks(options?.webxrSupported ?? true));
  }

  if (options?.geolocation !== false) {
    cleanups.push(installGeolocationMocks());
  }

  if (options?.fileSystem !== false) {
    cleanups.push(installFileSystemMocks(options?.rootDir));
  }

  return () => {
    for (const cleanup of cleanups) {
      cleanup();
    }
  };
}

// ============================================================================
// Origin Private File System (OPFS) Mocks
// ============================================================================

/**
 * In-memory file system for OPFS mocking.
 * Stores file contents as ArrayBuffer for binary compatibility.
 */
export class MockOPFSDirectoryHandle implements FileSystemDirectoryHandle {
  kind = 'directory' as const;
  name: string;
  private contents = new Map<
    string,
    FileSystemDirectoryHandle | FileSystemFileHandle
  >();
  private fileContents = new Map<string, ArrayBuffer>();

  constructor(name: string) {
    this.name = name;
  }

  /**
   * Get stored file content (for test assertions).
   */
  getStoredContent(fileName: string): ArrayBuffer | undefined {
    return this.fileContents.get(fileName);
  }

  /**
   * Get stored file content as string (for test assertions).
   */
  getStoredContentAsString(fileName: string): string | undefined {
    const content = this.fileContents.get(fileName);
    if (!content) {
      return undefined;
    }
    return new TextDecoder().decode(content);
  }

  /**
   * Set file content directly (for test setup).
   * Also ensures a corresponding file handle exists in contents map
   * so that getFileHandle() and iterators work correctly.
   */
  setStoredContent(fileName: string, content: string | ArrayBuffer): void {
    if (typeof content === 'string') {
      this.fileContents.set(fileName, new TextEncoder().encode(content).buffer);
    } else {
      this.fileContents.set(fileName, content);
    }
    // Ensure file handle exists in contents map for getFileHandle() and iterators
    if (!this.contents.has(fileName)) {
      this.contents.set(
        fileName,
        new MockOPFSFileHandle(fileName, this, fileName)
      );
    }
  }

  async *entries() {
    await Promise.resolve();
    for (const entry of this.contents) {
      yield entry;
    }
    return undefined;
  }

  async *[Symbol.asyncIterator]() {
    await Promise.resolve();
    for (const entry of this.contents) {
      yield entry;
    }
    return undefined;
  }

  getDirectoryHandle(
    name: string,
    options?: { create?: boolean }
  ): Promise<FileSystemDirectoryHandle> {
    const handle = this.contents.get(name);
    if (handle && handle.kind === 'directory') {
      return Promise.resolve(handle);
    }
    // Spec fidelity (File System standard): when the name is taken by a FILE,
    // getDirectoryHandle rejects with TypeMismatchError — with AND without
    // `create` — it never replaces the entry. Production code branches on this
    // error name (e.g. opfs-storage's createSession collision probe).
    if (handle) {
      return Promise.reject(
        new DOMException(`${name} is not a directory`, 'TypeMismatchError')
      );
    }
    if (options?.create) {
      const newHandle = new MockOPFSDirectoryHandle(name);
      this.contents.set(name, newHandle);
      return Promise.resolve(newHandle);
    }
    return Promise.reject(
      new DOMException(`Directory ${name} not found`, 'NotFoundError')
    );
  }

  getFileHandle(
    name: string,
    options?: { create?: boolean }
  ): Promise<FileSystemFileHandle> {
    const handle = this.contents.get(name);
    if (handle && handle.kind === 'file') {
      return Promise.resolve(handle);
    }
    // Spec fidelity: a DIRECTORY occupying the name → TypeMismatchError (see
    // getDirectoryHandle above for the mirrored case).
    if (handle) {
      return Promise.reject(
        new DOMException(`${name} is not a file`, 'TypeMismatchError')
      );
    }
    if (options?.create) {
      const newHandle = new MockOPFSFileHandle(name, this, name);
      this.contents.set(name, newHandle);
      return Promise.resolve(newHandle);
    }
    return Promise.reject(
      new DOMException(`File ${name} not found`, 'NotFoundError')
    );
  }

  removeEntry(name: string): Promise<void> {
    this.contents.delete(name);
    this.fileContents.delete(name);
    return Promise.resolve();
  }

  resolve(): Promise<string[] | null> {
    throw new Error('Not implemented');
  }

  isSameEntry(): Promise<boolean> {
    throw new Error('Not implemented');
  }

  async *values() {
    await Promise.resolve();
    for (const handle of this.contents.values()) {
      yield handle;
    }
    return undefined;
  }

  async *keys() {
    await Promise.resolve();
    for (const name of this.contents.keys()) {
      yield name;
    }
    return undefined;
  }

  queryPermission(_descriptor?: {
    mode?: 'read' | 'readwrite';
  }): Promise<PermissionState> {
    return Promise.resolve('granted');
  }

  requestPermission(_descriptor?: {
    mode?: 'read' | 'readwrite';
  }): Promise<PermissionState> {
    return Promise.resolve('granted');
  }
}

/**
 * Mock OPFS file handle with writable stream support.
 */
export class MockOPFSFileHandle implements FileSystemFileHandle {
  kind = 'file' as const;
  name: string;
  private parentDir: MockOPFSDirectoryHandle;
  private storageKey: string;

  constructor(
    name: string,
    parentDir: MockOPFSDirectoryHandle,
    storageKey: string
  ) {
    this.name = name;
    this.parentDir = parentDir;
    this.storageKey = storageKey;
  }

  getFile(): Promise<File> {
    const content = this.parentDir.getStoredContent(this.storageKey);
    const contentArray = content ? new Uint8Array(content) : new Uint8Array(0);

    // Create a File object with text() method since jsdom may not have it
    const file = new File([contentArray], this.name, {
      type: 'application/octet-stream',
    });

    // Add text() method if not present (jsdom compatibility)
    if (typeof file.text !== 'function') {
      (file as unknown as { text: () => Promise<string> }).text = () =>
        Promise.resolve(new TextDecoder().decode(contentArray));
    }

    // Add arrayBuffer() method if not present (jsdom compatibility)
    if (typeof file.arrayBuffer !== 'function') {
      (
        file as unknown as { arrayBuffer: () => Promise<ArrayBuffer> }
      ).arrayBuffer = () => Promise.resolve(contentArray.buffer.slice(0));
    }

    return Promise.resolve(file);
  }

  createWritable(): Promise<FileSystemWritableFileStream> {
    const chunks: ArrayBuffer[] = [];
    const parentDir = this.parentDir;
    const storageKey = this.storageKey;

    const writable = {
      write: vi.fn(async (data: BufferSource | Blob | string) => {
        if (typeof data === 'string') {
          chunks.push(new TextEncoder().encode(data).buffer);
        } else if (data instanceof Blob) {
          // Handle Blob - use arrayBuffer() if available, else use FileReader
          if (typeof data.arrayBuffer === 'function') {
            const buffer = await data.arrayBuffer();
            chunks.push(buffer);
          } else {
            // Fallback for jsdom Blob which may not have arrayBuffer()
            const text = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(reader.result as string);
              reader.onerror = reject;
              reader.readAsText(data);
            });
            chunks.push(new TextEncoder().encode(text).buffer);
          }
        } else if (data instanceof ArrayBuffer) {
          chunks.push(data);
        } else if (ArrayBuffer.isView(data)) {
          chunks.push(
            data.buffer.slice(
              data.byteOffset,
              data.byteOffset + data.byteLength
            )
          );
        }
      }),
      close: vi.fn(() => {
        // Combine all chunks into final content
        const totalLength = chunks.reduce(
          (sum, chunk) => sum + chunk.byteLength,
          0
        );
        const combined = new Uint8Array(totalLength);
        let offset = 0;
        for (const chunk of chunks) {
          combined.set(new Uint8Array(chunk), offset);
          offset += chunk.byteLength;
        }
        parentDir.setStoredContent(storageKey, combined.buffer);
        return Promise.resolve();
      }),
      seek: vi.fn(),
      truncate: vi.fn(),
      abort: vi.fn(() => Promise.resolve()),
      locked: false,
      getWriter: vi.fn(),
    } as unknown as FileSystemWritableFileStream;

    return Promise.resolve(writable);
  }

  createSyncAccessHandle(): Promise<unknown> {
    throw new Error('Not implemented in mock');
  }

  isSameEntry(): Promise<boolean> {
    throw new Error('Not implemented');
  }
}

/**
 * Mock navigator.storage for OPFS support.
 */
export interface MockStorageManager {
  getDirectory: () => Promise<FileSystemDirectoryHandle>;
  estimate: () => Promise<{ quota: number; usage: number }>;
  persist: () => Promise<boolean>;
  persisted: () => Promise<boolean>;
}

/**
 * Create a mock StorageManager with OPFS support.
 */
export function createMockStorageManager(
  opfsRoot?: MockOPFSDirectoryHandle
): MockStorageManager {
  const root = opfsRoot ?? new MockOPFSDirectoryHandle('');
  return {
    getDirectory: vi.fn(() => Promise.resolve(root)),
    estimate: vi.fn(() =>
      Promise.resolve({ quota: 1024 * 1024 * 1024, usage: 0 })
    ),
    persist: vi.fn(() => Promise.resolve(true)),
    persisted: vi.fn(() => Promise.resolve(true)),
  };
}

/**
 * Install OPFS mocks on the global navigator object.
 * Returns the mock OPFS root directory for test assertions and cleanup function.
 */
export function installOPFSMocks(opfsRoot?: MockOPFSDirectoryHandle): {
  root: MockOPFSDirectoryHandle;
  cleanup: () => void;
} {
  const root = opfsRoot ?? new MockOPFSDirectoryHandle('');
  const mockStorage = createMockStorageManager(root);
  const existingNavigator = typeof navigator !== 'undefined' ? navigator : {};
  vi.stubGlobal('navigator', { ...existingNavigator, storage: mockStorage });
  return { root, cleanup: () => vi.unstubAllGlobals() };
}
