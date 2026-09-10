// TypeScript declaration for WebXR types not included in lib.dom
// These extend the Navigator and related interfaces for XR support

declare global {
  interface Navigator {
    xr?: XRSystem;
  }

  interface XRSystem {
    isSessionSupported(mode: XRSessionMode): Promise<boolean>;
    requestSession(
      mode: XRSessionMode,
      options?: XRSessionInit
    ): Promise<XRSession>;
  }

  type XRSessionMode = 'inline' | 'immersive-vr' | 'immersive-ar';

  interface XRSessionInit {
    requiredFeatures?: string[];
    optionalFeatures?: string[];
    domOverlay?: { root: Element | null };
  }

  interface XRSession extends EventTarget {
    end(): Promise<void>;
    requestReferenceSpace(
      type: XRReferenceSpaceType
    ): Promise<XRReferenceSpace>;
    addEventListener(type: 'end', listener: () => void): void;
  }

  type XRReferenceSpaceType =
    'local' | 'local-floor' | 'bounded-floor' | 'unbounded' | 'viewer';

  interface XRReferenceSpace extends EventTarget {
    getOffsetReferenceSpace(originOffset: XRRigidTransform): XRReferenceSpace;
  }

  interface XRFrame {
    getViewerPose(referenceSpace: XRReferenceSpace): XRViewerPose | null;
  }

  interface XRViewerPose {
    views: readonly XRView[];
    transform: XRRigidTransform;
  }

  interface XRView {
    eye: 'left' | 'right' | 'none';
    projectionMatrix: Float32Array;
    transform: XRRigidTransform;
  }

  interface XRRigidTransform {
    position: DOMPointReadOnly;
    orientation: DOMPointReadOnly;
    matrix: Float32Array;
    inverse: XRRigidTransform;
  }

  // File System Access API
  interface Window {
    showDirectoryPicker(
      options?: ShowDirectoryPickerOptions
    ): Promise<FileSystemDirectoryHandle>;
  }

  interface ShowDirectoryPickerOptions {
    mode?: 'read' | 'readwrite';
    startIn?:
      | FileSystemHandle
      | 'desktop'
      | 'documents'
      | 'downloads'
      | 'music'
      | 'pictures'
      | 'videos';
  }

  interface FileSystemDirectoryHandle extends FileSystemHandle {
    kind: 'directory';
    getDirectoryHandle(
      name: string,
      options?: { create?: boolean }
    ): Promise<FileSystemDirectoryHandle>;
    getFileHandle(
      name: string,
      options?: { create?: boolean }
    ): Promise<FileSystemFileHandle>;
    values(): AsyncIterableIterator<FileSystemHandle>;
    entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
    /** Check permission state without prompting the user. */
    queryPermission(descriptor?: {
      mode?: 'read' | 'readwrite';
    }): Promise<PermissionState>;
    /** Request a permission (may prompt the user; must follow a user gesture). */
    requestPermission(descriptor?: {
      mode?: 'read' | 'readwrite';
    }): Promise<PermissionState>;
  }

  interface FileSystemFileHandle extends FileSystemHandle {
    kind: 'file';
    getFile(): Promise<File>;
    createWritable(): Promise<FileSystemWritableFileStream>;
  }

  interface FileSystemWritableFileStream extends WritableStream {
    write(data: BufferSource | Blob | string): Promise<void>;
    seek(position: number): Promise<void>;
    truncate(size: number): Promise<void>;
    close(): Promise<void>;
  }

  interface FileSystemHandle {
    kind: 'file' | 'directory';
    name: string;
  }
}

export {};
