/** Thrown when the persistence service is used in a non-Chrome environment. */
export class UnsupportedEnvironmentError extends Error {
  constructor(message = 'File System Access API requires Google Chrome.') {
    super(message);
    this.name = 'UnsupportedEnvironmentError';
  }
}

/** Thrown when save/flush/downloadAs is called with a container that does not match the active session. */
export class ContainerSessionMismatchError extends Error {
  constructor(message = 'Container does not match the active session. Use the container returned by open().') {
    super(message);
    this.name = 'ContainerSessionMismatchError';
  }
}

/** Thrown when a native write is attempted but no FileSystemFileHandle is bound (detached session). */
export class NativeHandleMissingError extends Error {
  constructor(message = 'No native file handle bound. Re-open the file via the picker or use downloadAs().') {
    super(message);
    this.name = 'NativeHandleMissingError';
  }
}

/** Thrown when the browser revokes permission for the native file handle during a write. */
export class NativePermissionDeniedError extends Error {
  constructor(cause?: unknown) {
    const msg = typeof cause === 'string' ? cause : (cause instanceof Error ? cause.message : 'Native file write permission denied or revoked.');
    super(msg);
    this.name = 'NativePermissionDeniedError';
    if (cause instanceof Error && cause.stack) {
      this.stack = this.stack + '\nCaused by: ' + cause.stack;
    }
  }
}

/** Thrown when the native write stream fails for reasons other than permission (e.g. disk full). */
export class NativeWriteFailedError extends Error {
  constructor(cause?: unknown) {
    const msg = typeof cause === 'string' ? cause : (cause instanceof Error ? cause.message : 'Native file write failed.');
    super(msg);
    this.name = 'NativeWriteFailedError';
    if (cause instanceof Error && cause.stack) {
      this.stack = this.stack + '\nCaused by: ' + cause.stack;
    }
  }
}

/** Thrown when the export/download flow cannot complete. */
export class ExportFailedError extends Error {
  constructor(message = 'File export failed.') {
    super(message);
    this.name = 'ExportFailedError';
  }
}
