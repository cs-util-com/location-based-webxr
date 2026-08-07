/**
 * OPFS Storage Module
 *
 * Uses the Origin Private File System (OPFS) API to persist recording data.
 * OPFS works consistently on Desktop Chrome, Android Chrome, and iOS Safari,
 * unlike showDirectoryPicker which has write restrictions on Android.
 *
 * Directory structure (flat sessions — no scenario hierarchy):
 * /gps-plus-slam/
 *   └── sessions/
 *       ├── recording-YYYY-MM-DD_HH-MM-SSutc/
 *       │   ├── session.json
 *       │   ├── actions/
 *       │   │   ├── 000001.json
 *       │   │   └── ...
 *       │   └── images/        (legacy recordings: frames/)
 *       │       ├── frame-000001.jpg
 *       │       └── ...
 *       └── ...
 *
 * Scenario grouping (scenarios/{name}/recording-…) is a recorder-only concern,
 * handled by ScenarioWrappingStorageBackend in the recorder app.
 */

import { createLogger } from '../utils/logger';
import { writeFileOrAbort } from './write-file-or-abort.js';
import {
  formatTimestamp,
  formatActionFilename,
  formatFrameFilename,
  SESSION_IMAGES_DIR,
} from './file-system-utils';

const log = createLogger('OPFS');

// ============================================================================
// Types
// ============================================================================

/**
 * Session metadata stored in session.json.
 */
export interface SessionMetadata {
  /** Schema version for forward compatibility */
  version: 1;
  /**
   * Odometry coordinate convention version.
   * - Absent (era 1, old recordings): odomPosition in raw WebXR frame [xrX, xrY, xrZ],
   *   GPS payload uses `gpsPoint` with ENU coordinates and derived fields.
   * - 2 (era 2): odomPosition in NUE frame [-xrZ, xrY, xrX],
   *   GPS payload uses `gpsPoint` with NUE coordinates and derived fields.
   * - 3 (era 3): odomPosition in raw WebXR [xrX, xrY, xrZ],
   *   GPS payload uses `gpsPoint` with NUE coordinates and derived fields.
   * - 4 (era 4): odomPosition in raw WebXR [xrX, xrY, xrZ],
   *   GPS payload uses `rawGpsPoint` (raw sensor fields only, no derived fields).
   * - 5 (era 5, current): Same action format as era 4. State-side change only:
   *   reducer now also converts quaternion rotations from WebXR to NUE.
   * Used during replay to determine whether migration is needed.
   */
  odomCoordVersion?: 2 | 3 | 4 | 5;
  /** ISO 8601 timestamp when recording started */
  startedAt: string;
  /** ISO 8601 timestamp when recording ended */
  endedAt: string;
  /**
   * Opaque tag the framework does not interpret. Consumers (e.g. the recorder)
   * use it to carry application-specific grouping info such as a scenario name.
   * Replaces the former required `scenarioName` field.
   */
  contextTag?: string;
  /** Total number of actions recorded */
  actionCount: number;
  /** Total number of frames captured */
  frameCount: number;
  /** Browser user agent string */
  userAgent: string;

  /** Build/environment info for debugging. Optional for backwards compat. */
  build?: {
    /** Git commit hash (short, e.g. "a1b2c3d"), or "dev" during local dev without git */
    commitHash: string;
    /** App version from package.json (e.g. "0.1.0") */
    appVersion: string;
    /** Library version from gps-plus-slam-js package.json */
    libraryVersion: string;
    /** Framework version from gps-plus-slam-app-framework package.json */
    frameworkVersion: string;
    /** ISO 8601 timestamp of when this build was produced */
    buildTime: string;
  };

  /** The page URL the recording was made from (origin + pathname only). Optional for backwards compat. */
  pageUrl?: string;

  /**
   * Per-tour H3 coverage index: the deduplicated H3 cells (at {@link h3Resolution})
   * that the recording's GPS path crossed. Powers the map-centric recording
   * browser — it shows roughly where each tour was recorded and which tours cross
   * a given tile — WITHOUT unzipping the GPS action data (the cells are read
   * straight from session.json during folder discovery). Computed from the raw GPS
   * path at recording stop via `gpsPathToCoverageCells`.
   *
   * Optional for backwards compatibility: legacy recordings predate this field and
   * are backfilled in memory from their GPS path on demand by the browser.
   */
  h3Cells?: string[];

  /**
   * The H3 resolution used to compute {@link h3Cells} (currently
   * `H3_RESOLUTION` = 11). Stored so older readers stay self-describing if the
   * capture resolution ever changes.
   */
  h3Resolution?: number;
}

/**
 * Result from createSession.
 */
export interface CreateSessionResult {
  sessionName: string;
}

// ============================================================================
// Module State
// ============================================================================

let opfsRoot: FileSystemDirectoryHandle | null = null;
let gpsPlusSlamDir: FileSystemDirectoryHandle | null = null;
let sessionsDir: FileSystemDirectoryHandle | null = null;
let currentSessionHandle: FileSystemDirectoryHandle | null = null;
let actionsHandle: FileSystemDirectoryHandle | null = null;
let framesHandle: FileSystemDirectoryHandle | null = null;

/**
 * Reset module state - exported for testing only.
 * @internal
 */
export function resetOpfsStorage(): void {
  opfsRoot = null;
  gpsPlusSlamDir = null;
  sessionsDir = null;
  currentSessionHandle = null;
  actionsHandle = null;
  framesHandle = null;
}

/**
 * Reset session-level handles only.
 *
 * Preserves opfsRoot/gpsPlusSlamDir/sessionsDir (OPFS stays initialized)
 * but clears current session/actions/frames handles so a new session can
 * be started fresh.
 */
export function resetSessionHandles(): void {
  currentSessionHandle = null;
  actionsHandle = null;
  framesHandle = null;
}

// ============================================================================
// Initialization
// ============================================================================

/**
 * Initialize OPFS storage by creating the required directory structure.
 *
 * Creates:
 * - /gps-plus-slam/
 * - /gps-plus-slam/sessions/
 *
 * This is idempotent - calling multiple times is safe.
 *
 * @throws Error if OPFS is not supported
 */
export async function initOpfsStorage(): Promise<void> {
  if (
    typeof navigator === 'undefined' ||
    !navigator.storage ||
    typeof navigator.storage.getDirectory !== 'function'
  ) {
    throw new Error(
      'OPFS (Origin Private File System) is not supported in this browser. ' +
        'Please use Chrome 86+, Safari 15.2+, or Firefox 111+.'
    );
  }

  opfsRoot = await navigator.storage.getDirectory();
  log.info('OPFS root obtained');

  gpsPlusSlamDir = await opfsRoot.getDirectoryHandle('gps-plus-slam', {
    create: true,
  });
  sessionsDir = await gpsPlusSlamDir.getDirectoryHandle('sessions', {
    create: true,
  });

  log.info('OPFS storage initialized');
}

/**
 * Get the sessions root directory handle.
 * Used by consumers that need direct OPFS access (e.g. ZIP export).
 */
export function getSessionsRootHandle(): FileSystemDirectoryHandle | null {
  return sessionsDir;
}

/**
 * Get the app root directory handle (gps-plus-slam/).
 * Used by consumers that need to create additional directories alongside sessions/.
 */
export function getAppRootHandle(): FileSystemDirectoryHandle | null {
  return gpsPlusSlamDir;
}

// ============================================================================
// Session Management
// ============================================================================

/**
 * True when the name `name` is already taken under `dir` (by a session
 * directory — or by a file, which the follow-up `{ create: true }` call could
 * not replace either). Used by {@link createSession} to avoid silently reusing
 * a directory when two recordings start within the same (second-resolution)
 * timestamp. Rethrows unexpected probe errors (storage failures) so the caller
 * fails loudly instead of mislabeling the name.
 */
async function sessionDirExists(
  dir: FileSystemDirectoryHandle,
  name: string
): Promise<boolean> {
  try {
    await dir.getDirectoryHandle(name, { create: false });
    return true;
  } catch (err) {
    // Only NotFoundError means the name is free. A FILE occupying the name
    // rejects with TypeMismatchError — report it TAKEN so the probe advances
    // to the next suffix instead of crashing on the follow-up
    // `{ create: true }` (which also rejects for a file-occupied name).
    // Anything else (InvalidStateError etc.) is a storage failure, not
    // knowledge about the name: rethrow ("free" would crash later with a
    // misleading create-time error; "taken" would loop the probe forever).
    if (err instanceof DOMException && err.name === 'NotFoundError') {
      return false;
    }
    if (err instanceof DOMException && err.name === 'TypeMismatchError') {
      return true;
    }
    throw err;
  }
}

/**
 * Create a new recording session.
 *
 * Creates the directory structure:
 * - /gps-plus-slam/sessions/recording-{timestamp}/
 * - /gps-plus-slam/sessions/recording-{timestamp}/actions/
 * - /gps-plus-slam/sessions/recording-{timestamp}/images/ (legacy: frames/)
 *
 * The folder name is `recording-{timestamp}` at whole-second resolution; if a
 * directory with that name already exists (two recordings started in the same
 * UTC second), a numeric suffix (`-2`, `-3`, …) is appended so the new session
 * never silently reuses and corrupts the earlier one's directory.
 *
 * @param timestamp - Session start time (used for folder naming)
 * @param _contextTag - Opaque tag; not used by the flat layout but accepted
 *   for interface compatibility with wrapping backends
 * @returns Session information
 * @throws Error if storage not initialized
 */
export async function createSession(
  timestamp: Date,
  _contextTag?: string
): Promise<CreateSessionResult> {
  if (!sessionsDir) {
    throw new Error(
      'OPFS storage not initialized. Call initOpfsStorage first.'
    );
  }

  // `formatTimestamp` resolves to whole UTC seconds, so two recordings started
  // within the same second collide on `recording-<ts>/`. Because the handle is
  // opened with `{ create: true }`, a colliding name silently REUSES the
  // existing directory and mixes both recordings' session.json/actions/frames.
  // Probe for a free name and append a numeric suffix on collision so each
  // session owns a distinct directory (the first keeps the bare timestamp).
  const baseName = `recording-${formatTimestamp(timestamp)}`;
  let sessionName = baseName;
  let suffix = 1;
  while (await sessionDirExists(sessionsDir, sessionName)) {
    suffix += 1;
    sessionName = `${baseName}-${suffix}`;
  }
  currentSessionHandle = await sessionsDir.getDirectoryHandle(sessionName, {
    create: true,
  });

  actionsHandle = await currentSessionHandle.getDirectoryHandle('actions', {
    create: true,
  });
  framesHandle = await currentSessionHandle.getDirectoryHandle(
    SESSION_IMAGES_DIR,
    { create: true }
  );

  log.info('Session created:', sessionName);

  return { sessionName };
}

/**
 * Get the current session directory handle.
 * @internal
 */
export function getSessionHandle(): FileSystemDirectoryHandle | null {
  return currentSessionHandle;
}

/**
 * Set the active session handles externally.
 *
 * Lets a wrapping StorageBackend that creates sessions outside the flat layout
 * (e.g. the recorder's `ScenarioWrappingStorageBackend`, which nests sessions
 * under a named bucket) reuse opfs-storage's write infrastructure: it creates
 * the session directory itself, then hands the handles here so subsequent
 * `writeAction` / `writeFrame` / `writeSessionMetadata` calls target them.
 *
 * @internal
 */
export function setSessionHandles(
  session: FileSystemDirectoryHandle,
  actions: FileSystemDirectoryHandle,
  frames: FileSystemDirectoryHandle
): void {
  currentSessionHandle = session;
  actionsHandle = actions;
  framesHandle = frames;
}

// ============================================================================
// Writing Data
// ============================================================================

/**
 * Write a Redux action to the current session's actions directory.
 *
 * @param action - The action object to write
 * @param index - Sequential action index (1-based)
 * @throws Error if no active session
 */
export async function writeAction(
  action: unknown,
  index: number
): Promise<void> {
  if (!actionsHandle) {
    throw new Error('No active session. Call createSession first.');
  }

  const filename = formatActionFilename(index);
  const fileHandle = await actionsHandle.getFileHandle(filename, {
    create: true,
  });

  const json = JSON.stringify(action, null, 2);
  await writeFileOrAbort(fileHandle, json);
}

/**
 * Write a frame blob to the current session's frames directory.
 *
 * @param blob - Image blob to write
 * @param index - Sequential frame index (1-based)
 * @throws Error if no active session
 */
export async function writeFrame(blob: Blob, index: number): Promise<void> {
  if (!framesHandle) {
    throw new Error('No active session. Call createSession first.');
  }

  const filename = formatFrameFilename(index);
  const fileHandle = await framesHandle.getFileHandle(filename, {
    create: true,
  });

  await writeFileOrAbort(fileHandle, blob);
}

/**
 * Write session metadata to session.json in the current session directory.
 *
 * @param metadata - Session metadata object
 * @throws Error if no active session
 */
export async function writeSessionMetadata(
  metadata: SessionMetadata
): Promise<void> {
  if (!currentSessionHandle) {
    throw new Error('No active session. Call createSession first.');
  }

  const fileHandle = await currentSessionHandle.getFileHandle('session.json', {
    create: true,
  });

  const json = JSON.stringify(metadata, null, 2);
  await writeFileOrAbort(fileHandle, json);

  log.info('Session metadata written');
}

// ============================================================================
// Listing
// ============================================================================

/**
 * List all session names in OPFS storage.
 *
 * @returns Array of session folder names
 */
export async function listSessions(): Promise<string[]> {
  if (!sessionsDir) {
    return [];
  }

  const sessions: string[] = [];
  for await (const entry of sessionsDir.values()) {
    if (entry.kind === 'directory') {
      sessions.push(entry.name);
    }
  }

  return sessions;
}

/**
 * Check storage quota.
 *
 * @returns Available and used storage in bytes
 */
export async function checkStorageQuota(): Promise<{
  available: number;
  used: number;
}> {
  if (
    typeof navigator === 'undefined' ||
    !navigator.storage ||
    typeof navigator.storage.estimate !== 'function'
  ) {
    log.warn('Storage Manager API not available, returning zero quota');
    return { available: 0, used: 0 };
  }

  const estimate = await navigator.storage.estimate();
  return {
    available: estimate.quota ?? 0,
    used: estimate.usage ?? 0,
  };
}
