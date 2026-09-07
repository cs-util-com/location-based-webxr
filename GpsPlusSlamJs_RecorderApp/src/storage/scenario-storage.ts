/**
 * Scenario Storage (recorder-owned)
 *
 * Layers the recorder's "scenario" concept — a named bucket grouping multiple
 * recordings of the same place — on top of the framework's scenario-FREE OPFS
 * primitives. This is the recorder-side home for the directory logic that used
 * to live in the framework's `storage/file-system.ts`; it was carved out in
 * Iter 7 of the AppFramework / RecorderApp boundary migration so the framework
 * never has to know about scenarios.
 *
 * @see gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-03-appframework-vs-recorderapp-boundary-analysis.md
 *
 * Directory layout owned here:
 *
 *   /gps-plus-slam/                       (framework root)
 *     └── scenarios/                      (recorder-owned grouping layer)
 *         └── {scenarioName}/
 *             └── recording-{timestamp}/
 *                 ├── session.json
 *                 ├── actions/000001.json …
 *                 └── images/frame-000001.jpg …   (legacy: frames/)
 *
 * The framework's own default layout is flat `sessions/{timestamp}/…` under the
 * same root; the two coexist side-by-side under `gps-plus-slam/`.
 *
 * Composition strategy: every actual byte-level write reuses the framework's
 * `opfs-storage` module via {@link opfsSetSessionHandles} — i.e. this module
 * creates the scenario-nested session directory, then hands its handles to the
 * framework writer so action/frame/metadata persistence stays in one place.
 *
 * State note: scenario state lives at MODULE scope (not on a backend instance)
 * because the recorder builds a fresh store + `ScenarioWrappingStorageBackend`
 * per recording, and the current scenario handle is selected during setup on a
 * previous store. Per-instance state would lose that selection (Issue #12).
 */

import { createLogger } from 'gps-plus-slam-app-framework/utils/logger';
import { setFileSystemState } from 'gps-plus-slam-app-framework/sensors/permission-checker';
import {
  initOpfsStorage,
  createSession as createOpfsSession,
  writeAction as opfsWriteAction,
  writeFrame as opfsWriteFrame,
  writeSessionMetadata as opfsWriteSessionMetadata,
  listSessions as opfsListSessions,
  getAppRootHandle,
  setSessionHandles as opfsSetSessionHandles,
  resetOpfsStorage,
  resetSessionHandles,
  type SessionMetadata,
} from 'gps-plus-slam-app-framework/storage/opfs-storage';
import {
  formatTimestamp,
  SESSION_IMAGES_DIR,
} from 'gps-plus-slam-app-framework/storage/file-system-utils';
import type {
  StorageBackend,
  CreateSessionResult,
} from 'gps-plus-slam-app-framework/storage/storage-backend';

const log = createLogger('ScenarioStorage');

// Module-level scenario state (see header note on Issue #12).
let _currentScenarioName: string | null = null;
let _currentSessionName: string | null = null;
let storageInitialized = false;
let scenariosDir: FileSystemDirectoryHandle | null = null;
let currentScenarioHandle: FileSystemDirectoryHandle | null = null;

/**
 * Reset all module state — exported for testing only.
 * @internal
 */
export function resetScenarioStorage(): void {
  _currentScenarioName = null;
  _currentSessionName = null;
  storageInitialized = false;
  scenariosDir = null;
  currentScenarioHandle = null;
  resetOpfsStorage();
}

/**
 * Reset session-level state for a new recording.
 *
 * Clears scenario/session names and OPFS session handles, but preserves
 * `storageInitialized` and the OPFS root so `initStorage()` doesn't need to be
 * called again.
 */
export function resetForNewSession(): void {
  _currentScenarioName = null;
  _currentSessionName = null;
  currentScenarioHandle = null;
  resetSessionHandles();
}

// ============================================================================
// Scenario directory management
// ============================================================================

async function ensureScenariosDir(): Promise<FileSystemDirectoryHandle | null> {
  if (scenariosDir) return scenariosDir;
  const appRoot = getAppRootHandle();
  if (!appRoot) return null;
  scenariosDir = await appRoot.getDirectoryHandle('scenarios', {
    create: true,
  });
  return scenariosDir;
}

/**
 * List all scenario names in OPFS storage.
 */
async function listScenarios(): Promise<string[]> {
  const dir = await ensureScenariosDir();
  if (!dir) return [];

  const scenarios: string[] = [];
  for await (const entry of dir.values()) {
    if (entry.kind === 'directory') {
      scenarios.push(entry.name);
    }
  }
  return scenarios;
}

/**
 * Initialize storage using OPFS.
 *
 * @returns List of existing scenario folder names
 * @throws Error if OPFS is not supported
 */
export async function initStorage(): Promise<string[]> {
  try {
    await initOpfsStorage();
    storageInitialized = true;

    setFileSystemState({
      folderSelected: true,
      writeVerified: true,
    });

    // Ensure scenarios dir exists and list existing scenarios.
    await ensureScenariosDir();
    const scenarios = await listScenarios();
    log.info('OPFS storage initialized, found scenarios:', scenarios);

    return scenarios;
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    log.error('OPFS initialization failed:', error);

    setFileSystemState({
      folderSelected: false,
      writeVerified: false,
      writeError: error.message,
    });

    throw error;
  }
}

// ============================================================================
// Session lifecycle
// ============================================================================

/**
 * Create the scenario-nested session directory tree for `scenarioName` at
 * `timestamp`, and bridge its handles into the framework's `opfs-storage`
 * writer so subsequent action/frame/metadata writes land in it.
 */
async function createScenarioSession(
  scenarioName: string,
  timestamp: Date
): Promise<{ scenarioPath: string; sessionPath: string }> {
  const dir = await ensureScenariosDir();
  if (!dir) {
    throw new Error('Failed to access scenarios directory.');
  }
  const scenarioHandle = await dir.getDirectoryHandle(scenarioName, {
    create: true,
  });
  currentScenarioHandle = scenarioHandle;

  const sessionName = `recording-${formatTimestamp(timestamp)}`;
  const sessionHandle = await scenarioHandle.getDirectoryHandle(sessionName, {
    create: true,
  });
  const actionsHandle = await sessionHandle.getDirectoryHandle('actions', {
    create: true,
  });
  const framesHandle = await sessionHandle.getDirectoryHandle(
    SESSION_IMAGES_DIR,
    { create: true }
  );

  // Bridge: reuse the framework writer's session handles.
  opfsSetSessionHandles(sessionHandle, actionsHandle, framesHandle);

  _currentScenarioName = scenarioName;
  _currentSessionName = sessionName;

  log.info('Session started:', `${scenarioName}/${sessionName}`);

  return { scenarioPath: scenarioName, sessionPath: sessionName };
}

/**
 * Create a new session folder.
 *
 * When `scenarioName` is provided, creates under the scenario directory
 * (`scenarios/{name}/`). When omitted, delegates to the framework's flat
 * `sessions/` layout.
 *
 * @param scenarioName - Optional name of the scenario (omit for flat layout)
 */
export async function startSession(
  scenarioName?: string
): Promise<{ scenarioPath: string; sessionPath: string }> {
  if (!storageInitialized) {
    throw new Error('Storage not initialized. Call initStorage first.');
  }

  if (scenarioName) {
    return createScenarioSession(scenarioName, new Date());
  }

  // Flat path: delegate to the framework's scenario-free layout.
  const result = await createOpfsSession(new Date());

  _currentScenarioName = '';
  _currentSessionName = result.sessionName;

  log.info('Session started:', result.sessionName);

  return { scenarioPath: '', sessionPath: result.sessionName };
}

/**
 * List all session names.
 *
 * When `scenarioName` is provided, lists sessions under that scenario.
 * Otherwise lists the framework's flat sessions. Internal — exposed to
 * consumers via `ScenarioWrappingStorageBackend.listSessions()`.
 */
async function listSessions(scenarioName?: string): Promise<string[]> {
  if (scenarioName) {
    const dir = await ensureScenariosDir();
    if (!dir) return [];
    try {
      const scenarioHandle = await dir.getDirectoryHandle(scenarioName);
      const sessions: string[] = [];
      for await (const entry of scenarioHandle.values()) {
        if (entry.kind === 'directory') {
          sessions.push(entry.name);
        }
      }
      return sessions;
    } catch {
      return [];
    }
  }
  return opfsListSessions();
}

// ============================================================================
// Scenario selection
// ============================================================================

/**
 * Get the current scenario handle (for loading prior sessions). Sync accessor;
 * the handle is cached during `startSession` / `setCurrentScenario` /
 * `ensureScenarioDirectory`.
 */
export function getCurrentScenarioHandle(): FileSystemDirectoryHandle | null {
  if (!_currentScenarioName) return null;
  return currentScenarioHandle;
}

/**
 * Set the current scenario handle (when the user selects a scenario). Returns
 * `null` if the scenario does not exist in OPFS.
 */
export async function setCurrentScenario(
  scenarioName: string
): Promise<FileSystemDirectoryHandle | null> {
  const scenRoot = await ensureScenariosDir();
  if (!scenRoot) {
    return null;
  }

  try {
    const handle = await scenRoot.getDirectoryHandle(scenarioName);
    _currentScenarioName = scenarioName;
    currentScenarioHandle = handle;
    return handle;
  } catch {
    log.warn('Scenario not found:', scenarioName);
    return null;
  }
}

/**
 * Ensure a scenario directory exists in OPFS, creating it if necessary. Used
 * during OPFS recovery (rebuilding a scenario after a browser data clear).
 */
export async function ensureScenarioDirectory(
  scenarioName: string
): Promise<FileSystemDirectoryHandle | null> {
  const scenRoot = await ensureScenariosDir();
  if (!scenRoot) {
    return null;
  }

  try {
    const handle = await scenRoot.getDirectoryHandle(scenarioName, {
      create: true,
    });
    _currentScenarioName = scenarioName;
    currentScenarioHandle = handle;
    return handle;
  } catch (err) {
    log.error('Failed to create scenario directory:', err);
    return null;
  }
}

/**
 * Open a scenario directory WITHOUT repointing the module's current-scenario
 * state — unlike `setCurrentScenario`/`ensureScenarioDirectory`, which cache
 * the handle as "current" as a side effect. Used by the eager ref-point
 * indexing pass, which writes into many scenarios while the user's selected
 * scenario must stay current (2026-07-05 folder-import plan §3.2).
 *
 * @returns The directory handle, or `null` when storage is uninitialized or
 * the scenario does not exist and `create` was not requested.
 * @throws Any other storage failure (`QuotaExceededError`,
 * `TypeMismatchError` — a file occupying the scenario name — etc.): mapping
 * those to `null` made the eager indexing pass skip the scenario and report
 * SUCCESS with fewer points written instead of surfacing the error.
 */
export async function getScenarioDirectoryHandle(
  scenarioName: string,
  options: { create?: boolean } = {}
): Promise<FileSystemDirectoryHandle | null> {
  const scenRoot = await ensureScenariosDir();
  if (!scenRoot) {
    return null;
  }
  try {
    return await scenRoot.getDirectoryHandle(scenarioName, {
      create: options.create === true,
    });
  } catch (err) {
    // Only "missing scenario, create not requested" is knowledge about the
    // scenario; everything else is a storage failure the caller must hear
    // about loudly (see @throws above).
    if (
      options.create !== true &&
      err instanceof DOMException &&
      err.name === 'NotFoundError'
    ) {
      return null;
    }
    throw err;
  }
}

// ============================================================================
// Maintenance
// ============================================================================

/**
 * Result of clearing the reference-point cache across all scenarios.
 */
export interface ClearRefPointsCacheResult {
  /** Number of scenarios whose `refPoints/` directory was deleted. */
  readonly scenariosCleared: number;
  /** Total number of scenarios scanned (including ones with no cache). */
  readonly scenariosScanned: number;
  /** Names of scenarios that failed to clear, with reason. */
  readonly errors: { scenarioName: string; reason: string }[];
}

/** Outcome of clearing one scenario's `refPoints/` cache. */
type ClearScenarioOutcome =
  { kind: 'cleared' } | { kind: 'skipped' } | { kind: 'error'; reason: string };

/**
 * Remove one scenario's `refPoints/` cache. A missing cache (`NotFoundError`)
 * is a `skipped` no-op, not an error.
 */
async function clearScenarioRefPointsCache(
  scenariosRoot: FileSystemDirectoryHandle,
  scenarioName: string
): Promise<ClearScenarioOutcome> {
  try {
    const handle = await scenariosRoot.getDirectoryHandle(scenarioName);
    await handle.removeEntry('refPoints', { recursive: true });
    return { kind: 'cleared' };
  } catch (err) {
    const name =
      err instanceof Error
        ? err.name
        : String((err as { name?: string })?.name);
    if (name === 'NotFoundError') return { kind: 'skipped' };
    return {
      kind: 'error',
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Clear the cached `refPoints/` directory for every scenario in OPFS.
 *
 * Used by the "Clear Reference Point Cache" maintenance action so that the next
 * scenario load re-imports ref points from the read folder's `*.zip`
 * recordings (see `ref-point-recovery`).
 *
 * Failures for individual scenarios are collected in `errors` rather than
 * aborting the whole operation — partial progress is still useful.
 *
 * @throws Error if OPFS storage is unavailable (e.g. `initStorage()` not yet
 *   called, or browser does not support OPFS). Surfacing this loudly avoids
 *   reporting a silent "0 scenarios cleared" success that would mask the real
 *   failure to the user.
 */
export async function clearRefPointsCacheForAllScenarios(): Promise<ClearRefPointsCacheResult> {
  const dir = await ensureScenariosDir();
  if (!dir) {
    throw new Error(
      'clearRefPointsCacheForAllScenarios: OPFS scenarios directory is unavailable — call initStorage() first or check OPFS support'
    );
  }

  const errors: { scenarioName: string; reason: string }[] = [];
  let scenariosCleared = 0;
  let scenariosScanned = 0;

  for (const scenarioName of await listScenarios()) {
    scenariosScanned++;
    const outcome = await clearScenarioRefPointsCache(dir, scenarioName);
    if (outcome.kind === 'cleared') scenariosCleared++;
    else if (outcome.kind === 'error')
      errors.push({ scenarioName, reason: outcome.reason });
  }

  log.info(
    `Cleared ref-point cache for ${scenariosCleared}/${scenariosScanned} scenarios (${errors.length} errors)`
  );
  return { scenariosCleared, scenariosScanned, errors };
}

// ============================================================================
// StorageBackend
// ============================================================================

/**
 * `StorageBackend` that layers the recorder's `scenarios/{name}/` hierarchy on
 * top of the framework's flat-session OPFS primitives.
 *
 * `createSession(timestamp, contextTag)` interprets `contextTag` as the
 * scenario name and creates `scenarios/{contextTag}/recording-{ts}/`; when
 * `contextTag` is omitted it falls back to the framework's flat layout.
 *
 * All instances share the module-level scenario state (see header note), so a
 * fresh backend built for a new recording still sees the scenario the user
 * selected during setup.
 */
export class ScenarioWrappingStorageBackend implements StorageBackend {
  async createSession(
    timestamp: Date,
    contextTag?: string
  ): Promise<CreateSessionResult> {
    if (!storageInitialized) {
      throw new Error('Storage not initialized. Call initStorage first.');
    }
    if (contextTag) {
      const { sessionPath } = await createScenarioSession(
        contextTag,
        timestamp
      );
      return { sessionName: sessionPath };
    }
    const result = await createOpfsSession(timestamp);
    _currentScenarioName = '';
    // Drop the previous scenario's directory handle too (PR #106 review): the
    // public accessor already answers null while the name is empty, but the
    // retained reference kept the handle alive and left module state
    // internally inconsistent (empty name, non-null handle).
    currentScenarioHandle = null;
    _currentSessionName = result.sessionName;
    return { sessionName: result.sessionName };
  }

  async listSessions(): Promise<string[]> {
    return listSessions(_currentScenarioName ?? undefined);
  }

  async writeAction(action: unknown, index: number): Promise<void> {
    await opfsWriteAction(action, index);
  }

  async writeFrame(blob: Blob, index: number): Promise<void> {
    await opfsWriteFrame(blob, index);
  }

  async writeSessionMetadata(metadata: SessionMetadata): Promise<void> {
    await opfsWriteSessionMetadata(metadata);
  }
}
