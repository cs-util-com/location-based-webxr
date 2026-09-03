# main.ts

## Purpose

Application entry point. Initializes WebXR, wires up UI callbacks, and orchestrates the recording workflow.

## Public API

This module is the entry point that runs on page load. It also exports the following for the soft-reset flow and testing:

| Export                                   | Type                     | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------------------------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `resetForNewRecording()`                 | `async () => void`       | Orchestrates soft reset: tears down current session (store, trackers, sync, map), ends the WebXR session (best-effort — a rejected end is logged and the reset continues; required because `initAR()` throws on a live session, so the next Enter AR must start clean), creates fresh store (and resumes the debug wheel onto it - a wheel suspended by a replay swap would otherwise hold every change silently), resets storage/UI state, and checks if read folder permission is still granted. |
| `getImportedRefPoints()`                 | `() => KnownGeoAnchor[]` | Returns the sidecar-imported known anchors (entries with `timestamp === 0`) from the flat `refPoints` slice via `selectImportedKnownAnchors`. Test-only seam.                                                                                                                                                                                                                                                                                                                                      |
| `setImportedRefPointsForTesting(points)` | `(points) => void`       | Dispatches `setImportedRefPointEntries` into the flat `refPoints` slice; each input becomes a `RefPointEntry` with `timestamp: 0` (sidecar marker). Test-only.                                                                                                                                                                                                                                                                                                                                     |
| `setCurrentScenarioName(name)`           | `(string) => void`       | Sets current scenario name (test-only).                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `handleRefPointIndexingSettled(outcome)` | `(outcome) => void`      | Terminal-outcome handler of the eager folder-import ref-point indexing pass (D2/D3, 2026-07-05): success → durable bar end state via `setFolderImportProgress` + "Recovered N reference points from M recordings" info toast when N > 0 (visible inside AR; quiet when N = 0); error → bar reset + error toast; aborted → silent bar reset. Wired as the folder-manager's `onIndexingSettled` dep; exported for testing.                                                                           |

## Internal Flow

1. **Check WebXR support** - Exits early with error if unsupported
2. **Initialize UI** - Wires up button callbacks to handler functions
3. **Initialize Session Summary** - Wires up summary panel callbacks
4. **Handle folder selection** - Calls `initStorage()`, populates scenario dropdown
5. **Handle Enter AR** - Builds ONE `ArSessionCallbacks` struct (depth,
   optional cameraFrame, tracking {store + onRestarted/onLost/onRecovered},
   imageCapture incl. a stable `qualityAnalyzer` wrapper, the per-frame
   `onFrame` tick, `onSessionEnd`) and passes it as `initAR()`'s 4th argument
   (the framework's pre-init setters were folded into `initAR` — surface
   reduction step 1). The closures read module-level `let`s at fire time, so
   resources created after init (and per-recording swaps) are picked up.
   Mid-session mutations go through two narrow seams: the framework's
   `rebindTrackingStore` (store swap per recording) and main's
   `activeImageQualityAnalyzer` ref (per-recording quality-gate Worker behind
   the stable `qualityAnalyzer` wrapper; fail-open `{ accept: true }` while
   null).
6. **Handle recording controls** - Start/stop recording, mark reference points
7. **Handle stop recording** - Collects summary data and shows Session Summary panel

## Invariants & Assumptions

- Runs in a browser with potential WebXR support
- DOM elements exist in `index.html` (buttons, modals, etc.)
- File System Access API available (Chrome Android 142+)
- **Navigation store getter**: `initNavigation` receives `() => store` (not `store` directly) so that after soft reset the navigation module always resolves the current store instance (Bug 9 fix).
- **Reference point counts**: When displaying reference point info in status messages,
  always distinguish between unique reference points (`refPointDefs.length`) and
  total observations (`flattenRefPointsToMarks(refPointDefs).length`). Use format:
  `"N ref points (M observations)"` to avoid confusion.
- **AR-session resource lifecycle — `arSessionScope`**
  ([utils/ar-session-scope.ts](utils/ar-session-scope.ts.md), 2026-07-11
  lifecycle-scope plan): every AR-session-scoped resource (visualizers,
  subscriptions, frame-loop handles, the lazily created map overlay) registers
  its teardown in the module-level `arSessionScope` at its creation site.
  `handleEnterAR` starts with `arSessionScope.dispose()` (the re-enter guard:
  `handleEnterAR` runs again on every "back to setup → Enter AR" cycle and
  `onBackToSetup` performs no teardown) and `resetMainState()` is
  `arSessionScope.dispose()` plus the app-lifetime resets. Disposal runs in
  reverse creation order — per block, subscriptions unwind before the
  visualizers they feed. Gated layers (stats overlay, compass cubes, frame
  tiles, live occluder, loop-closure capture, QR recording) go through
  `arSessionScope.wire(name, enabled, factory)`, which also owns the
  best-effort try/catch: a wiring failure logs a warning and recording
  continues without that layer. The occupancy-grid block is wired with
  `enabled: true` (the grid always exists for COLMAP export; only the cube
  mesh is gated). The cube visualizer is parented under `arWorldGroup` (NOT
  the scene root): the grid's cells are raw-WebXR coordinates that must ride
  the alignment matrix like the camera (port plan Iter 7 reparenting fix).
  **Wiring-internal handles are closure-locals** (2026-07-18 simplify-loop
  Area 6): a resource read only inside its own wire factory + disposer
  (visualizer instances, unsubscribe functions, frame-loop unregisters) lives
  as a `const` in that closure — never as a module-level `let` with a
  `x?.dispose(); x = null` teardown mirror. The handles genuinely read across
  functions live in ONE record,
  [`ar/ar-session-resources.ts`](ar/ar-session-resources.ts.md) — `mapOverlay`,
  `cameraFollower`, `alignmentLerper`, `statsOverlay`, `loopClosureHandler`,
  `qrProducer`, `refPointViews` — read at FIRE time through
  `arSessionResources.<slot>`. Holding them together is what lets the scene
  wiring live outside this file; the per-RECORDING
  `activeImageQualityAnalyzer` stays a module `let` here because it is
  deliberately NOT session-scoped.
- **Scene wiring lives in [`ar/wire-ar-scene.ts`](ar/wire-ar-scene.ts.md)**:
  after `initAR` resolves, `handleEnterAR` passes the scene handles, the
  options, the scope and the resources record to `wireArScene`, which attaches
  every visualizer/grid/subscriber block. `main.ts` keeps only the session
  negotiation, the callbacks struct and the user-facing status/error paths.
- **Live QR recording + debug viz** (opt-in, `recording-options.qr.enabled`;
  recorder live-QR WS-2/WS-5). When enabled, `handleEnterAR` includes the
  camera-frame group in the `ArSessionCallbacks` struct passed to `initAR`
  (`callbacks.cameraFrame.onFrame` forwards frames to the producer held in
  `qrProducer`) and, after AR init inside its own
  best-effort `try/catch`, calls `wireQrRecording` (under `arWorldGroup`) to build
  the thin RAW producer + the WS-5 debug axis+cube subscriber (teardown
  registered in `arSessionScope` like the occupancy/frame-tile layers). See
  [qr/wire-qr-recording.ts.md](qr/wire-qr-recording.ts.md). Disabled by default,
  so an existing recording is byte-for-byte unaffected.
- **Live debug-overlay toggles** (`recording-options.visualization.*`, Finding B
  of the [2026-06-14 follow-up](../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-06-14-0012-frame-tile-legacy-aspect-and-live-toggle-followup.md)):
  `handleEnterAR` reads the four toggles ONCE at Enter-AR (toggling mid-session
  applies on the next Enter-AR; replay is never gated). Each uses the mechanism
  that fits its consumer:
  - **frameTiles** / **compassCubes** — skipped entirely when off (no
    non-visual consumer; the frame-blob cache is filled in
    `handleImageCaptured`, independent of the tile wiring). The frame-tile
    teardown still runs unconditionally so turning it off cleanly removes a
    prior cycle's tiles.
  - **gpsAlignmentMarkers** — NOT skipped; `gpsEventVisualizer.setVisible(flag)`
    only hides the spheres, because their alignment-snapshot positions feed the
    session-summary map at stop.
  - **occupancyCubes** — gates only the rendered cube `InstancedMesh`. The
    `OccupancyGrid` is **always** built, published via `setOccupancyGrid`, and
    fed by `wireOccupancyGridSubscribers`, because the COLMAP export and other
    non-visualizer consumers read it through `getOccupancyGrid()`. When off, the
    wirer gets a no-op visualizer sink so the grid still folds in every depth
    sample without allocating GPU geometry.
  - **statsOverlay** (default OFF — Step 0 of the
    [2026-07-03 long-session fps plan](../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-07-03-1344-long-session-fps-and-voxel-grid-scaling-plan.md)) —
    mounts the Stats.js FPS/ms/MB panel row (the framework's
    `createPerfStatsOverlay`, `gps-plus-slam-app-framework/visualization/perf-stats-overlay`)
    into the `#app` dom-overlay root and advances it from the initAR
    `callbacks.onFrame` tick. Teardown runs via
    `arSessionScope` on re-enter (panels never stack) and in `resetMainState`
    (no frozen panels on the setup screen). The occupancy wirer additionally gets
    `onGridSize` telemetry (one `[OccupancyGrid] <n> cells` log per ~30 s) so a
    log export correlates grid growth with the fps trend.

- **Map-centric recording browser (Step 4C) lives in
  [ui/map-browser-launcher.ts](ui/map-browser-launcher.ts.md)** (extracted from
  main.ts 2026-07-11): main.ts only wires `launchMapBrowser` into the
  folder-manager's `onReplayFolderScanned` dep — injecting
  `startReplayForEntry` from the replay handlers as the launcher's single
  composition-root dependency — and injects `ensureMapBrowserRoot` into the
  Playwright e2e hooks. The browser is **app-lifetime** state (replay/setup
  screen), so it is intentionally NOT registered in `arSessionScope`; its
  teardown is driven by its own UI paths inside the launcher module.

- **Playwright hooks live in [test-utils/e2e-hooks.ts](test-utils/e2e-hooks.ts.md)**:
  main.ts only triggers `installE2eTestHooks` through a dynamic import guarded
  by `import.meta.env.DEV && !VITEST`, so the fixture scaffolding never
  reaches production bundles or the unit-test module graph. The
  `window.testHooks` key set is pinned against `REQUIRED_TEST_HOOKS` in
  `playwright-tests/test-helpers.js`.

## Examples

The module self-executes:

```typescript
// In browser, automatically runs main() on import
import './main';
```

## Tests

- Unit tests in `main.test.ts` — 32 tests covering:
  - Store creation, AR flow, recording lifecycle
  - Session summary data collection
  - Progress tracking (frame/action counters)
  - Reference point deduplication (imported + scenario)
  - **Soft reset** (Issue 4): tests for `resetForNewRecording()`:
    - Calls all cleanup functions (hideSessionSummary, resetForNewSession, etc.)
    - Creates a fresh store
    - Keeps folder when read permission still granted
    - Clears folder + imported ref points when permission lost
    - Graceful handling of permission check returning false
    - Ends the WebXR session exactly once (so the next Enter AR passes the
      `initAR()` re-entry guard) and completes the reset even when
      `endARSession()` rejects
- E2E tests in `playwright-tests/smoke.spec.js` verify the page loads
- E2E tests in `playwright-tests/session-summary.spec.js` verify post-recording summary
