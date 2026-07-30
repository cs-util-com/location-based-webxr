/**
 * Folder Manager
 *
 * Encapsulates folder/save-location selection, scenario management, and
 * OPFS scenario caching, extracted from main.ts (Finding #7 — main.ts
 * decomposition, Step 4).
 *
 * `FolderManagerDeps` injects exactly two kinds of dependency, and nothing
 * else belongs in it:
 *   1. State that changes over the app lifecycle and is owned elsewhere —
 *      the live store, replay-mode state, the replay zip cache.
 *   2. UI effects this storage module may not import: dependency-cruiser's
 *      `no-storage-importing-ui` forbids storage → ui, so every status line,
 *      toast and dropdown update arrives as a callback.
 *
 * Everything else is imported directly. In particular the folder/zip SCAN is
 * a plain import (`recording-discovery`) — it used to arrive as three
 * callbacks purely because that module was misfiled under `ui/`, which also
 * forced a structural copy of `SessionEntry` here. Both are gone since the
 * 2026-07-30 move; do not reintroduce a callback for something importable.
 */

import {
  isExternalStorageSupported,
  selectReadFolder,
  selectSaveFile,
  getReadFolderHandle,
} from './external-file-storage';
import {
  setCurrentScenario,
  ensureScenarioDirectory,
  getScenarioDirectoryHandle,
} from './scenario-storage';
import {
  loadAllRefPoints,
  flattenRefPointsToMarks,
  averageGpsPerRefPoint,
  writeRefPointDefinition,
  type RefPointDefinition,
} from '../storage/ref-point-loader';
import { indexRefPointDefinitionsFromFolder } from '../storage/ref-point-recovery';
import { mergeSiblingRefPoints } from '../storage/ref-point-merge';
import {
  listScenariosFromFolder,
  extractScenarioNamesFromZips,
  discoverScenariosFromZipMetadata,
  type SessionEntry,
} from './recording-discovery';
import {
  isH3Index,
  h3CellsMatch,
} from 'gps-plus-slam-app-framework/geo/h3-proximity';
import { createLogger } from 'gps-plus-slam-app-framework/utils/logger';
import { setCurrentScenarioName } from '../state/scenario-slice';
import { setImportedRefPointEntries } from '../state/ref-points-slice';
import type { RecorderStore } from '../state/recorder-store';

const log = createLogger('FolderManager');

/**
 * Is a definition's cell already represented among the accepted ids?
 * H3 ids match exactly or as gridDisk neighbors (`h3CellsMatch`, catching GPS
 * jitter across recordings — same pattern as the importer's dedupe); legacy
 * non-H3 ids (pre-March-2026 zips) fall back to exact comparison.
 */
function isCellCovered(id: string, acceptedIds: readonly string[]): boolean {
  if (!isH3Index(id)) {
    return acceptedIds.includes(id);
  }
  return acceptedIds.some(
    (accepted) =>
      accepted === id || (isH3Index(accepted) && h3CellsMatch(accepted, id))
  );
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Terminal outcome of the eager ref-point indexing pass started by a folder
 * pick (2026-07-05 folder-import plan §3.3). Consumed by the progress UI
 * (durable end state) and the completion toast — always via the
 * `FolderManagerDeps['onIndexingSettled']` callback type (kept unexported:
 * knip flags exports with no external importer).
 */
type RefPointIndexingOutcome =
  | {
      status: 'success';
      /** Definitions newly written across all scenarios (gap-fill, D4b). */
      refPointsWritten: number;
      /** ZIPs successfully read. */
      zipFilesScanned: number;
      /** ZIPs discovered in the folder (including failed ones). */
      zipFilesTotal: number;
      /** Per-ZIP / per-entry error messages (non-fatal). */
      errors: string[];
    }
  | { status: 'error'; message: string }
  | { status: 'aborted' };

export interface FolderManagerDeps {
  /** Check if the app is in replay mode (owned by replayHandlers). */
  getIsReplayMode: () => boolean;
  /** Cache zip→scenario mapping for replay (owned by replayHandlers). */
  setReplayZipScenariosCache: (cache: Map<string, SessionEntry[]>) => void;
  /** Access the current store instance (may change between recordings). */
  getStore: () => RecorderStore;
  /** UI: show error toast/banner. */
  showError: (msg: string) => void;
  /** UI: update main status line. */
  updateStatus: (msg: string) => void;
  /** UI: populate scenario dropdown. */
  populateScenarios: (scenarios: string[]) => void;
  /** UI: mark save location as selected in the HUD. */
  setSaveLocationSelected: (selected: boolean) => void;
  /**
   * UI: expand/collapse the optional folder-import section and show a hint.
   * D5: auto-expanded when the chosen scenario has no OPFS reference points.
   */
  setFolderImportExpanded: (expanded: boolean, hint?: string) => void;
  /** UI: revalidate the Enter AR button state. */
  validateEnterButton: () => void;
  /** UI: populate replay scenario list. */
  populateReplayScenarios: (scenarios: string[]) => void;
  /**
   * Optional: called after a folder is successfully scanned in replay mode,
   * with the folder handle. The map-centric browser (Step 4C) uses this to build
   * its coverage index and present itself as the primary replay selector.
   */
  onReplayFolderScanned?: (
    folderHandle: FileSystemDirectoryHandle
  ) => void | Promise<void>;
  /** UI: update folder-status display text. */
  updateFolderStatus: (text: string) => void;
  /** UI: update save-status display text. */
  updateSaveStatus: (text: string) => void;
  /**
   * UI: per-ZIP progress of the eager ref-point indexing pass (D2). Fired
   * with `{done: 0, total}` before the first ZIP, then once per ZIP.
   */
  onIndexingProgress?: (progress: { done: number; total: number }) => void;
  /** UI: terminal outcome of the eager indexing pass (bar end state, toast). */
  onIndexingSettled?: (outcome: RefPointIndexingOutcome) => void;
}

export interface FolderManager {
  /** Handle "Open Previous Recordings" button click. */
  handleOpenFolder(): Promise<void>;
  /** Handle "Choose Save Location" button click. */
  handleChooseSaveLocation(): Promise<void>;
  /** Handle scenario dropdown change. */
  handleScenarioChange(scenarioName: string): Promise<void>;
  /** Load, flatten, and display ref points from a scenario directory. */
  loadAndDisplayRefPoints(
    handle: FileSystemDirectoryHandle
  ): Promise<{ refPointCount: number; observationCount: number }>;

  /** Get current scenario name. */
  getCurrentScenarioName(): string;
  /** Set current scenario name. */
  setCurrentScenarioName(name: string): void;
  /** Get cached OPFS scenarios. */
  getCachedOpfsScenarios(): string[];
  /** Set cached OPFS scenarios. */
  setCachedOpfsScenarios(scenarios: string[]): void;

  /**
   * Abort the eager ref-point indexing pass, if one is running. Safe to call
   * anytime; used on app teardown and implied by reset().
   */
  abortActiveIndexing(): void;

  /** Reset all state to defaults. */
  reset(): void;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createFolderManager(deps: FolderManagerDeps): FolderManager {
  // --- State ---
  let cachedOpfsScenarios: string[] = [];
  /**
   * Single-flight guard for the eager ref-point indexing pass (plan §3.3):
   * a new folder pick aborts and replaces the running pass, and the lazy
   * scenario-change recovery no-ops while a pass is live.
   */
  let activeIndexing: { abort: AbortController } | null = null;

  // --- Public API ---

  async function handleOpenFolder(): Promise<void> {
    if (!isExternalStorageSupported()) {
      deps.showError('External file access is not supported in this browser.');
      return;
    }

    const result = await selectReadFolder();

    if (!result.success) {
      if (result.reason === 'cancelled') {
        return;
      }
      deps.showError(result.error ?? 'Failed to open folder.');
      return;
    }

    log.info('Opened folder for reading:', result.folderName);
    deps.updateFolderStatus(`⏳ Scanning ${result.folderName}...`);

    const folderHandle = getReadFolderHandle();
    if (!folderHandle) {
      log.error('Folder handle not available after selection');
      deps.updateFolderStatus('❌ Failed to access folder');
      return;
    }

    // Replay mode: discover scenarios from both subdirectories and zip metadata
    if (deps.getIsReplayMode()) {
      try {
        const [dirScenarios, zipDiscovery] = await Promise.all([
          listScenariosFromFolder(folderHandle),
          discoverScenariosFromZipMetadata(folderHandle),
        ]);
        deps.setReplayZipScenariosCache(zipDiscovery.scenarioSessions);
        const allScenarios = [
          ...new Set([...dirScenarios, ...zipDiscovery.scenarioNames]),
        ].sort();
        deps.populateReplayScenarios(allScenarios);
        const msg = `✅ ${result.folderName} (${allScenarios.length} scenario${allScenarios.length !== 1 ? 's' : ''})`;
        log.info(msg);
        deps.updateFolderStatus(msg);
        // Step 4C: hand the folder to the map-centric browser, which becomes the
        // primary replay selector. Failures here must not break the modal flow.
        try {
          await deps.onReplayFolderScanned?.(folderHandle);
        } catch (err) {
          log.error('Failed to open map browser for folder:', err);
        }
      } catch (err) {
        log.error('Failed to list scenarios from folder:', err);
        deps.updateFolderStatus('❌ Failed to read scenarios');
      }
      return;
    }

    // Recording mode: discover scenario names for the dropdown; the actual
    // ref-point import runs right after as the eager indexing pass below.
    try {
      const [folderScenarios, zipScenarios] = await Promise.all([
        listScenariosFromFolder(folderHandle),
        extractScenarioNamesFromZips(folderHandle),
      ]);
      const allScenarios = [
        ...new Set([
          ...cachedOpfsScenarios,
          ...folderScenarios,
          ...zipScenarios,
        ]),
      ].sort();
      if (allScenarios.length > 0) {
        deps.populateScenarios(allScenarios);
      }

      const scenarioLabel =
        allScenarios.length > 0
          ? `${allScenarios.length} scenario${allScenarios.length !== 1 ? 's' : ''}`
          : '';
      const msg = `✅ ${result.folderName}${scenarioLabel ? ` (${scenarioLabel})` : ''}`;
      log.info(msg);
      deps.updateFolderStatus(msg);
      deps.validateEnterButton();
    } catch (err) {
      log.error('Unexpected error during folder scan:', err);
      deps.updateFolderStatus('❌ Folder scan error - see logs');
    }

    // D1 (2026-07-05 plan §3.3): eagerly index the folder's ZIPs into
    // per-scenario ref points. Runs AFTER the Enter AR gate was validated
    // above — the pass never blocks entering AR (2026-06-05 decision D5);
    // it reports progress/outcome via the injected callbacks and handles
    // its own errors.
    await runEagerRefPointIndexing(folderHandle);
  }

  /**
   * Run the eager full-folder indexing pass: index all ZIPs (newest-first,
   * scenario-grouped), gap-fill each scenario's OPFS store (D4a/D4b/D4b-ii),
   * refresh the currently selected scenario if it gained points, and report
   * the terminal outcome. Never throws — failures surface via `showError` +
   * `onIndexingSettled`, aborts settle silently as `{status: 'aborted'}`.
   */
  async function runEagerRefPointIndexing(
    folderHandle: FileSystemDirectoryHandle
  ): Promise<void> {
    // Single-flight: a new folder pick replaces (and aborts) a running pass.
    activeIndexing?.abort.abort();
    const abort = new AbortController();
    const entry = { abort };
    activeIndexing = entry;

    let zipFilesTotal = 0;
    try {
      const result = await indexRefPointDefinitionsFromFolder(folderHandle, {
        signal: abort.signal,
        onProgress: (progress) => {
          zipFilesTotal = progress.total;
          deps.onIndexingProgress?.(progress);
        },
      });
      const written = await persistIndexedDefinitions(
        result.definitionsByScenario,
        abort.signal
      );
      // Late re-check: if the active scenario changed after its bucket was
      // persisted (or persisted without an early publish), refresh now.
      if (written.publishedScenario !== resolveActiveScenarioName()) {
        await refreshCurrentScenarioAfterIndexing(written.byScenario);
      }
      deps.onIndexingSettled?.({
        status: 'success',
        refPointsWritten: written.total,
        zipFilesScanned: result.zipFilesScanned,
        zipFilesTotal,
        errors: result.errors,
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        log.info('Eager ref-point indexing aborted');
        deps.onIndexingSettled?.({ status: 'aborted' });
      } else {
        const message = err instanceof Error ? err.message : 'Unknown error';
        log.warn('Eager ref-point indexing failed:', message);
        deps.showError(`Reference point indexing failed: ${message}`);
        deps.onIndexingSettled?.({ status: 'error', message });
      }
    } finally {
      if (activeIndexing === entry) {
        activeIndexing = null;
      }
    }
  }

  /**
   * Persist per-scenario definitions into their own OPFS stores (strict
   * routing, D4a) via the side-effect-free scenario handle accessor, so the
   * user's selected scenario never changes underneath them.
   *
   * The ACTIVE scenario's bucket is persisted FIRST and published (store
   * dispatch + status line + hint collapse) immediately once durable —
   * round-3 option 2 (2026-07-05): its points must not wait for the other
   * scenarios' buckets. Returns which scenario was early-published (if any)
   * so the caller can skip the redundant end-of-pass refresh.
   */
  async function persistIndexedDefinitions(
    definitionsByScenario: Map<string, RefPointDefinition[]>,
    signal: AbortSignal
  ): Promise<{
    total: number;
    byScenario: Map<string, number>;
    publishedScenario: string | null;
  }> {
    const byScenario = new Map<string, number>();
    let total = 0;
    let publishedScenario: string | null = null;

    // Active scenario first (stable order otherwise — buckets keep their
    // newest-first-encounter grouping from the indexing pass).
    const activeName = resolveActiveScenarioName();
    const ordered = [...definitionsByScenario.entries()].sort(
      ([a], [b]) => Number(b === activeName) - Number(a === activeName)
    );

    for (const [scenarioName, defs] of ordered) {
      if (signal.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }
      const handle = await getScenarioDirectoryHandle(scenarioName, {
        create: true,
      });
      if (!handle) {
        log.warn('Cannot open scenario directory for indexing:', scenarioName);
        continue;
      }
      const written = await gapFillScenarioStore(handle, defs);
      if (written > 0) {
        byScenario.set(scenarioName, written);
        total += written;
        log.info(`Indexed ${written} new ref point(s) into "${scenarioName}"`);
        // Early publish: the user's scenario is durable — show it now.
        if (scenarioName === activeName && publishedScenario === null) {
          await refreshCurrentScenarioAfterIndexing(byScenario);
          publishedScenario = scenarioName;
        }
      }
    }
    return { total, byScenario, publishedScenario };
  }

  /**
   * Gap-fill one scenario store (D4b/D4b-ii): walk the bucket in order
   * (newest recording first) and write only definitions whose H3 cell is not
   * yet covered — by an existing entry or by an earlier-accepted definition
   * of this pass (first-accepted-wins ⇒ newest wins a neighbor cluster).
   * Existing entries are never modified.
   */
  async function gapFillScenarioStore(
    scenarioHandle: FileSystemDirectoryHandle,
    defs: RefPointDefinition[]
  ): Promise<number> {
    const existing = await loadAllRefPoints(scenarioHandle);
    const acceptedIds = existing.map((d) => d.id);
    let written = 0;
    for (const def of defs) {
      if (isCellCovered(def.id, acceptedIds)) continue;
      await writeRefPointDefinition(scenarioHandle, def);
      acceptedIds.push(def.id);
      written++;
    }
    return written;
  }

  /**
   * Resolve which scenario the user is currently working in, robust across
   * the per-recording store swap: the dropdown selection lives in the boot
   * store's `scenario` slice, but `handleStartRecording` swaps in a FRESH
   * store whose scenario slice is empty — there the selection travels only
   * in the session metadata's `contextTag` (Issue #12). Reading just the
   * scenario slice made the post-indexing refresh silently no-op when a
   * recording started mid-pass (round-3 feedback, 2026-07-05: "Recovered N"
   * toast fired but no points ever appeared).
   */
  function resolveActiveScenarioName(): string {
    const state = deps.getStore().getState();
    return (
      state.scenario.currentScenarioName ||
      state.recording.sessionMetadata?.contextTag ||
      ''
    );
  }

  /**
   * After the pass, the hint that triggered the import ("open the recordings
   * folder to recover them") must be honored visibly: when the selected
   * scenario gained definitions, re-load it into the store/map/status line
   * and collapse the now-fulfilled import section.
   */
  async function refreshCurrentScenarioAfterIndexing(
    writtenByScenario: Map<string, number>
  ): Promise<void> {
    const current = resolveActiveScenarioName();
    if (!current || !writtenByScenario.has(current)) return;
    const handle = await setCurrentScenario(current);
    if (!handle) return;
    const { refPointCount, observationCount } =
      await loadAndDisplayRefPoints(handle);
    deps.updateStatus(
      `Scenario: ${current} | ${refPointCount} ref points (${observationCount} observations)`
    );
    deps.setFolderImportExpanded(false);
  }

  async function handleChooseSaveLocation(): Promise<void> {
    if (!isExternalStorageSupported()) {
      deps.showError('External file access is not supported in this browser.');
      return;
    }

    const result = await selectSaveFile();

    if (!result.success) {
      if (result.reason === 'cancelled') {
        return;
      }
      deps.showError(result.error ?? 'Failed to choose save location.');
      return;
    }

    log.info('Save location chosen:', result.fileName);
    deps.updateSaveStatus(`✅ ${result.fileName}`);
    deps.setSaveLocationSelected(true);
    deps.validateEnterButton();
  }

  async function handleScenarioChange(scenarioName: string): Promise<void> {
    log.info('Scenario changed to:', scenarioName);
    deps.getStore().dispatch(setCurrentScenarioName(scenarioName));

    try {
      let handle = await setCurrentScenario(scenarioName);

      // OPFS recovery: scenario directory may be gone after browser data clear.
      // If the user has a read folder with prior ZIPs, create the directory
      // so recovery can populate it with ref points.
      if (!handle) {
        const readFolder = getReadFolderHandle();
        if (readFolder) {
          log.info(
            'Scenario not in OPFS — creating directory for recovery:',
            scenarioName
          );
          handle = await ensureScenarioDirectory(scenarioName);
        }
      }

      if (handle) {
        const { refPointCount, observationCount } =
          await loadAndDisplayRefPoints(handle);
        deps.updateStatus(
          `Scenario: ${scenarioName} | ${refPointCount} ref points (${observationCount} observations)`
        );
        // D5 (F5-C): if this scenario has no saved reference points and no
        // read folder is open, surface the optional import step so the user
        // can recover them from prior recordings. Otherwise keep it collapsed.
        if (refPointCount === 0 && !getReadFolderHandle()) {
          deps.setFolderImportExpanded(
            true,
            `"${scenarioName}" has no saved reference points \u2014 open the recordings folder to recover them.`
          );
        } else {
          deps.setFolderImportExpanded(false);
        }
      } else {
        deps.showError(`Failed to load scenario: ${scenarioName}`);
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : 'Unknown error';
      log.error('Error changing scenario:', errMsg);
      deps.showError(`Error loading scenario: ${scenarioName}`);
    }
  }

  /**
   * Lazy safety net: recover the CURRENT scenario's ref points from the read
   * folder's ZIPs when its OPFS store is empty. Uses the same indexing pass
   * as the eager folder-pick flow, but persists only the current scenario's
   * bucket (strict routing, D4a — definitions of other scenarios must not
   * bleed into this store; the eager pass covers them at pick time).
   * Returns the re-loaded definitions, or [] on failure / no read folder.
   */
  async function tryRecoverRefPointsFromZips(
    opfsHandle: FileSystemDirectoryHandle
  ): Promise<RefPointDefinition[]> {
    // The eager pass already scans the whole folder and gap-fills every
    // scenario — racing it here would double-scan and double-write. The
    // pass refreshes the current scenario itself when it gains points.
    if (activeIndexing) {
      log.info('Skipping lazy ref-point recovery — eager indexing pass active');
      return [];
    }
    const readFolder = getReadFolderHandle();
    if (!readFolder) return [];
    try {
      // Swap-robust scenario resolution — see resolveActiveScenarioName.
      const scenarioName = resolveActiveScenarioName();
      log.info(
        `OPFS empty — recovering ref points from ZIPs for "${scenarioName}"...`
      );
      const result = await indexRefPointDefinitionsFromFolder(readFolder);
      const bucket = result.definitionsByScenario.get(scenarioName) ?? [];
      const written = await gapFillScenarioStore(opfsHandle, bucket);
      if (written > 0) {
        log.info(
          `Recovered ${written} ref points from ${result.zipFilesScanned} ZIPs`
        );
        return await loadAllRefPoints(opfsHandle);
      }
    } catch (err) {
      log.warn('Ref point recovery from ZIPs failed:', err);
    }
    return [];
  }

  async function loadAndDisplayRefPoints(
    handle: FileSystemDirectoryHandle
  ): Promise<{ refPointCount: number; observationCount: number }> {
    let refPointDefs = await loadAllRefPoints(handle);

    // OPFS recovery (Problem 2): when OPFS refPoints/ is empty and a read
    // folder with prior session ZIPs is available, recover full definitions
    // from ZIPs, persist them to OPFS, and re-load.
    if (refPointDefs.length === 0) {
      refPointDefs = await tryRecoverRefPointsFromZips(handle);
    }

    // D6(a): collapse sibling clusters (durable neighbor-cell twins, legacy
    // ids) IN MEMORY — display, capture-matching, and averaging all consume
    // merged definitions, so existing stores heal without any file rewrite.
    refPointDefs = mergeSiblingRefPoints(refPointDefs);

    const allObservations = flattenRefPointsToMarks(refPointDefs);

    // Compute averaged GPS per ref point ID for H3 + 2D map
    const averaged = averageGpsPerRefPoint(refPointDefs);

    // Populate the flat `refPoints` slice — the single source of truth
    // since 5.7a-3 Option C of the 2026-05-27 slice-collapse plan. Each
    // averaged ref point becomes a single sidecar `RefPointEntry` with
    // `timestamp: 0` (sidecar imports are not live observations). The 3D
    // visualizer subscribes to `selectRefPointEntries` (Step 5.3) and
    // renders one sphere per cell; the proximity matcher uses
    // `selectKnownAnchorsByCell` (Step 5.4) over the same slice.
    deps.getStore().dispatch(
      setImportedRefPointEntries(
        averaged.map((rp) => ({
          id: rp.id,
          timestamp: 0,
          name: rp.name,
          rawGpsPoint: {
            id: `imported-${rp.id}`,
            latitude: rp.lat,
            longitude: rp.lon,
            ...(rp.alt !== undefined ? { altitude: rp.alt } : {}),
            timestamp: 0,
          },
        }))
      )
    );

    // NOTE: no direct 2D-map call here any more. The live minimap renders
    // ref points from the store via wireRefPointMapMarkers (2026-07-05
    // live-map feedback) — the setImportedRefPointEntries dispatch above is
    // what feeds it. The previous deps.mapOverlay.addPriorMarkers call was
    // dead code: it ran at scenario-selection time, before the lazily
    // created overlay ever existed.

    return {
      refPointCount: refPointDefs.length,
      observationCount: allObservations.length,
    };
  }

  function abortActiveIndexing(): void {
    activeIndexing?.abort.abort();
    activeIndexing = null;
  }

  function reset(): void {
    abortActiveIndexing();
    deps.getStore().dispatch(setCurrentScenarioName(''));
    cachedOpfsScenarios = [];
  }

  return {
    handleOpenFolder,
    handleChooseSaveLocation,
    handleScenarioChange,
    loadAndDisplayRefPoints,
    abortActiveIndexing,
    getCurrentScenarioName: () =>
      deps.getStore().getState().scenario.currentScenarioName,
    setCurrentScenarioName: (name: string) => {
      deps.getStore().dispatch(setCurrentScenarioName(name));
    },
    getCachedOpfsScenarios: () => cachedOpfsScenarios,
    setCachedOpfsScenarios: (scenarios: string[]) => {
      cachedOpfsScenarios = scenarios;
    },
    reset,
  };
}
