# Folder Manager

## Purpose

Encapsulates folder/save-location selection, scenario management, and OPFS scenario caching — extracted from `main.ts` as part of Finding #7 Step 4.

## Public API

### `createFolderManager(deps: FolderManagerDeps): FolderManager`

Factory function that creates a folder manager instance with injected dependencies.

**Returned methods:**

| Method                              | Description                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `handleOpenFolder()`                | Opens folder picker, lists scenarios, populates UI. Behaves differently in recording vs replay mode. In recording mode it then **immediately starts the eager ref-point indexing pass** (D1, 2026-07-05 plan §3.3) — after `validateEnterButton`, so the pass never gates Enter AR.                                                                                                             |
| `abortActiveIndexing()`             | Aborts a running eager indexing pass (safe no-op otherwise). Called on app teardown; implied by `reset()`.                                                                                                                                                                                                                                                                                      |
| `handleChooseSaveLocation()`        | Opens save-file picker for external ZIP export. Guards on `isExternalStorageSupported()`.                                                                                                                                                                                                                                                                                                       |
| `handleScenarioChange(name)`        | Sets current scenario in storage, loads & displays reference points. D5: auto-expands the optional folder-import section (via `setFolderImportExpanded`) with a recovery hint when the chosen scenario has zero OPFS ref points and no read folder is open; otherwise collapses it.                                                                                                             |
| `loadAndDisplayRefPoints(handle)`   | Loads ref points, collapses sibling clusters in memory (`mergeSiblingRefPoints`, D6(a) — durable neighbor twins and legacy ids heal without file rewrites), flattens for 3D display, computes robust averaged GPS per ID, and dispatches to the store (H3 proximity, 3D visualizer, and — via `ui/ref-point-map-markers.ts` — the live minimap). Returns `{ refPointCount, observationCount }`. |
| `getCurrentScenarioName()`          | Reads the current scenario name from `state.scenario.currentScenarioName`.                                                                                                                                                                                                                                                                                                                      |
| `setCurrentScenarioName(name)`      | Dispatches `scenario/setCurrentScenarioName` to update the recorder-app `scenario` slice.                                                                                                                                                                                                                                                                                                       |
| `getCachedOpfsScenarios()`          | Returns the cached OPFS scenario names array.                                                                                                                                                                                                                                                                                                                                                   |
| `setCachedOpfsScenarios(scenarios)` | Sets the cached OPFS scenarios.                                                                                                                                                                                                                                                                                                                                                                 |
| `reset()`                           | Aborts any active indexing pass, resets `currentScenarioName` and `cachedOpfsScenarios` to defaults.                                                                                                                                                                                                                                                                                            |

### `FolderManagerDeps`

Dependencies injected from `main.ts`:

- **Cross-module state:** `getIsReplayMode`, `setReplayZipScenariosCache`
- **UI callbacks:** `showError`, `updateStatus`, `populateScenarios`, `setSaveLocationSelected`, `setFolderImportExpanded`, `validateEnterButton`, `populateReplayScenarios`, `updateFolderStatus`, `updateSaveStatus` (the write-only `setFolderSelected` was removed end-to-end in quality-review D-3)
- **Indexing pass callbacks (D2/D3, 2026-07-05):** `onIndexingProgress?({done,total})` — one event per ZIP (plus an initial `{0,total}`), drives the folder-import progress bar; `onIndexingSettled?(outcome)` — terminal `success | error | aborted` outcome (drives the bar's durable end state and the completion toast; the success variant carries `refPointsWritten`, `zipFilesScanned`, `zipFilesTotal`, `errors`)

(The former optional `mapOverlay` dep was removed in the 2026-07-05 live-map feedback round: its `addPriorMarkers` call always ran before the lazily created AR minimap existed. The minimap now renders ref points from the store via `ui/ref-point-map-markers.ts`, fed by the `setImportedRefPointEntries` dispatch below.)

UI functions are injected (not imported directly) to respect the `storage/ → ui/` dependency boundary rule enforced by dependency-cruiser. This includes status display helpers (`updateFolderStatus`, `updateSaveStatus`) so the module has zero direct DOM access.

**Only those two categories belong in `FolderManagerDeps`.** The folder/zip scan (`listScenariosFromFolder`, `extractScenarioNamesFromZips`, `discoverScenariosFromZipMetadata`) used to be injected as three more callbacks, and `SessionEntry` was duplicated here as a structural `SessionEntryLike` — both only because that scan lived in `ui/session-browser.ts` and the boundary rule blocked the import. It moved to [`storage/recording-discovery.ts`](recording-discovery.ts.md) on 2026-07-30, so the scan is now a plain import. Do not reintroduce a callback for something this module can import.

## Invariants & Assumptions

- `handleOpenFolder` checks `getIsReplayMode()` to branch between recording-mode (list scenarios, then run the eager indexing pass) and replay-mode (discover zip metadata + populate replay UI; no indexing — the map browser owns that flow).
- **Eager indexing pass (D1/D4, 2026-07-05 plan):** `indexRefPointDefinitionsFromFolder` scans all ZIPs newest-first and groups definitions per scenario; each bucket is **gap-filled into its own scenario store** via the side-effect-free `getScenarioDirectoryHandle` (strict routing D4a — no cross-scenario bleed). The gap-fill acceptance is first-accepted-wins over newest-first buckets: a definition is written only if its H3 cell is not covered by an existing entry or an earlier-accepted definition, exactly or as a `h3CellsMatch` gridDisk neighbor (`isCellCovered`; legacy non-H3 ids compare exactly). Existing entries are never modified (D4b); the newest recording wins a neighbor cluster (D4b-ii).
- **Single-flight:** a new folder pick (or `reset()`/`abortActiveIndexing()`) aborts the running pass (`AbortError` settles as `{status: 'aborted'}`, never as an error). The pass never throws — failures surface via `showError` + `onIndexingSettled({status: 'error'})`.
- **Current-scenario refresh (early publish, round-3 2026-07-05):** the active scenario's bucket is persisted FIRST and published immediately once durable — `loadAndDisplayRefPoints` re-run (store dispatch, map markers, status line) + `setFolderImportExpanded(false)` — without waiting for the other scenarios' buckets; the end-of-pass refresh only runs if the active scenario changed meanwhile. The "active scenario" is resolved swap-robustly (`resolveActiveScenarioName`: `scenario.currentScenarioName` → `recording.sessionMetadata.contextTag` fallback) because a recording start swaps in a fresh store whose scenario slice is empty.
- **Lazy safety net:** `loadAndDisplayRefPoints` still triggers recovery when a scenario's store is empty and a read folder is open — it runs the same indexing pass but persists **only the current scenario's bucket** (D4a; Slice 5b). It no-ops while an eager pass is live (no double-scan/double-write).
- In recording mode, folder and zip scenario names are merged and deduplicated before populating the dropdown.
- `loadAndDisplayRefPoints` clears existing visualized ref points before displaying new ones.
- **Ref-point import**: `loadAndDisplayRefPoints` dispatches `setImportedRefPointEntries` into the flat `refPoints` slice — the canonical store source for the H3 matcher since Step 5.4. Each averaged ref point becomes a single `RefPointEntry` with `timestamp: 0` (sidecar entries are not live observations) and a synthesised `rawGpsPoint` carrying the averaged lat/lon and (optional) altitude. (The legacy `deps.setImportedRefPoints` double-write was removed in 5.7a-3 of the [2026-05-27 slice-collapse plan](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-27-collapse-refpoint-and-frame-slices-plan.md).) Conflict rule: when an action-log replay (Step 5.6 translator) later appends `addRefPointEntry` rows for the same H3 cell, the new entries are appended after the sidecar entries; `selectKnownAnchorsByCell` keeps the first-non-null-`name` per cell, so the human-readable label from the sidecar wins for the `displayName` while live observations still contribute their own lat/lon snapshots to `state.refPoints.entries` for downstream consumers.
- `handleChooseSaveLocation` is a no-op (with error toast) when `isExternalStorageSupported()` returns false.
- **Map-browser launch (Step 4C):** after a successful replay-mode scan, `handleOpenFolder` calls the optional `onReplayFolderScanned(folderHandle)` dep so the map-centric browser can build its coverage index and present itself as the primary replay selector. The call is awaited but its failure is caught and logged — a map-browser launch error must not abort the modal flow. It is **not** called in recording mode.

## Examples

```ts
const folderManager = createFolderManager({
  getIsReplayMode: () => replayHandlers.getIsReplayMode(),
  setReplayZipScenariosCache: (c) =>
    replayHandlers.setReplayZipScenariosCache(c),
  showError,
  updateStatus,
  populateScenarios,
  setSaveLocationSelected,
  validateEnterButton,
  populateReplayScenarios,
  updateFolderStatus(text) {
    const el = document.getElementById('folder-status');
    if (el) el.textContent = text;
  },
  updateSaveStatus(text) {
    const el = document.getElementById('save-status');
    if (el) el.textContent = text;
  },
});

await folderManager.handleOpenFolder();
folderManager.getCurrentScenarioName(); // → 'MyScenario'
```

## Tests

- `storage/folder-manager.test.ts` — covering recording-mode folder open, replay-mode folder open, save location selection, scenario change, ref point loading with averaged GPS and map overlay forwarding, state accessors, reset, and the eager indexing pass (immediate start after Enter AR validation, per-scenario persistence, H3 gap-fill incl. neighbor skip and newest-wins, current-scenario refresh, single-flight abort, failure/abort outcomes, lazy-recovery no-op while active, strict-routing lazy recovery).
