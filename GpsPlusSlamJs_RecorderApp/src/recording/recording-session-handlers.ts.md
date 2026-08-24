# Recording Session Handlers

## Purpose

Encapsulates recording-session lifecycle state and event handlers, extracted from `main.ts` via a factory pattern. Dependencies that change over the app lifecycle (store, scenario name, recording options) are injected; sensor/storage/UI modules are imported directly.

## Public API

### Types

| Export                     | Kind      | Description                                                             |
| -------------------------- | --------- | ----------------------------------------------------------------------- |
| `RecordingSessionDeps`     | Interface | Dependency bag for the factory (store access, options, callbacks, etc.) |
| `RecordingSessionHandlers` | Interface | Returned handle with lifecycle methods and tracker proxies              |

### Factory

| Function                               | Returns                    | Description                                              |
| -------------------------------------- | -------------------------- | -------------------------------------------------------- |
| `createRecordingSessionHandlers(deps)` | `RecordingSessionHandlers` | Creates a handler set bound to the provided deps closure |

### Handler methods

| Method                        | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `handleStartRecording()`      | Starts session: storage, sensors, GPS watch, sync manager, store subscribers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `handleStopRecording()`       | Re-entrancy-guarded: stops sensors, final sync, hides recording controls (Bug 8 fix), shows summary                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `handleBackDuringRecording()` | Shows confirmation dialog; on confirm stops recording and navigates back                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `getCurrentSessionName()`     | Returns the current session name string                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `setCurrentSessionName(name)` | Sets session name                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `recordWriteSuccess()`        | Null-safe proxy to write-failure tracker                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `recordWriteFailure(err)`     | Null-safe proxy to write-failure tracker                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `recordCaptureSuccess()`      | Null-safe proxy to capture-failure tracker                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `recordCaptureFailure()`      | Null-safe proxy to capture-failure tracker                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `cleanupForNewRecording()`    | Soft reset with **teardown parity to `performStop`** (2026-07-04): first stops the live feeds via the shared `stopLiveFeeds()` (captures, sensor watches, quality-analyzer worker, HUD readouts — previously this path skipped them, leaving camera/GPS feeds and the Worker running), then tears down sync manager, store subscribers, failure trackers. **Reached only from the summary screen**, via `main.ts`'s `resetForNewRecording()` ("New recording" / Back from summary), so `performStop()` has always run first — which is why it does not disable the `beforeunload` warning |
| `reset()`                     | Full reset of all internal state                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

## State owned (private to each factory instance)

`writeFailureTracker` / `captureFailureTracker` (created per session),
`currentSessionName`, `syncManager` / `lastSyncResult`, `imageQualityClient`,
`absCompassHudTimer`, and the two re-entrancy guards
`backDuringRecordingInProgress` and `stopInProgress`, plus `unsubscribeStore`
for subscriber cleanup.

The ref-point **view** subscribers (3D spheres + live-map markers) are NOT wired
here — they are AR-scoped and store-swap-following via main's `storeRef`
([ui/ref-point-view-wiring.ts](../ui/ref-point-view-wiring.ts.md), round-3 feedback
2026-07-05). The `deps.setStore(newStore)` call in `handleStartRecording` is
what triggers their re-wire.

## Invariants & Assumptions

- **Factory pattern**: Each call to `createRecordingSessionHandlers` returns independent state. No module-level mutable state.
- **The GPS-marker opt-out must be re-asserted after `clearAll()` (regression fixed 2026-06-18)**: `handleStartRecording` calls `gpsEventVisualizer.clearAll()` to dispose the previous session's markers, but `clearAll()` resets the shared visualizer to its pristine **visible** state (a replay-safety reset). This path runs _after_ Enter-AR already applied the operator's `visualization.gpsAlignmentMarkers` opt-out, so the immediately following `setVisible(...)` is load-bearing — without it, GPS spheres reappear during recording even though the toggle is off.
- **Image-quality gate lifecycle**: when `recordingOptions.images.qualityFilter.enabled`, `handleStartRecording` spawns the off-thread analyzer worker (`createImageQualityAnalyzer`) and injects it via the `deps.setImageQualityAnalyzer` dep **before** `startImageCapture` (the manager reads the analyzer when constructed); when disabled it spawns no worker and clears the analyzer (`deps.setImageQualityAnalyzer(null)`) so a previous recording's worker can't leak in. The dep is injected by main.ts and writes main's `activeImageQualityAnalyzer` ref, which the stable `imageCapture.qualityAnalyzer` wrapper passed to `initAR` delegates to (the framework's `setImageQualityAnalyzer` export was deleted in the setter fold; recordings start/stop within one AR session, so the per-recording Worker cannot be an initAR-time constant). `performStop` clears the callback and `dispose()`s the worker. The worker is owned here (one per recording), so its rolling sharpness baseline resets each recording. **Fail-open on worker init**: the worker is constructed synchronously, so `new Worker` can throw on a locked-down deployment (e.g. CSP `worker-src`). That construction is wrapped in `try/catch` — on failure the gate is disabled (`deps.setImageQualityAnalyzer(null)`) and recording proceeds, rather than aborting a session whose GPS/orientation watches have already started. See `image-quality-client.ts.md`.
- **Dependency injection**: `getStore()` is called on every use to resolve the _current_ store (supports soft reset via Bug 9 getter pattern).
- **Scenario fallback is centralized**: Start-recording, metadata writing, and OPFS ZIP export all use the shared `FALLBACK_SCENARIO` constant when no scenario has been selected.
- **Recording controls cleanup**: `hideRecordingControls()` is called before transitioning to the summary screen so the HUD does not render on top of the summary overlay (Bug 8 fix).
- **WriteQueue drain before `actions/` readers (2026-07-12, indoor-loop enablement §3.6b)**: `performStop` awaits `store.flushPendingActionWrites()` (the persistence middleware's drain hook) right after `stopLiveFeeds()` and BEFORE the final external sync and the OPFS ZIP export — both read the session's `actions/`, and the middleware's write queue is async, so an action dispatched moments before Stop could otherwise land after the export enumerated the directory and silently miss the zip. The flush is failure-guarded (logged, never blocks the stop). Ordering pinned by the two "flushes pending action writes BEFORE …" tests.
- **Recording format**: New recordings write `odomCoordVersion: 5` to session metadata. Action payloads use `rawGpsPoint` (no derived fields) and `rawDeviceOrientation` as sibling fields. The reducer converts these to full `GpsPoint` when building state. Session metadata also includes optional `build` (commit hash, versions, build time) and a sanitized `pageUrl` (scheme + host + path, with search/hash stripped via the URL object) for debugging without persisting query/hash secrets. The scheme is preserved for URLs with opaque origins (e.g. `file://`).
- **Build metadata is best-effort**: `handleStopRecording()` logs and omits the optional `build` field if metadata lookup fails. The rest of `session.json` must still be written.
- **Back-button guard**: `backDuringRecordingInProgress` prevents concurrent back-button presses during the async stop flow.
- **Stop re-entrancy guard (Sentry issue 7319627943)**: `handleStopRecording()` is a thin guard around the real teardown (`performStop()`). A `stopInProgress` flag makes a second Stop tap during the multi-second final sync a no-op. Without it, the second invocation stopped + nulled the shared `syncManager` while the first was still awaiting `syncManager.syncNow()`, so the first then threw `Cannot read properties of null (reading 'stop')`. Defense in depth: `performStop()` also captures the manager into a local (`const sm = syncManager; syncManager = null;`) **before** the `await`, so any concurrent teardown (a second stop, or `cleanupForNewRecording`) sees `null` and no-ops instead of double-stopping. As feedback (and to remove the double-tap trigger), `handleStopRecording()` calls `setStopButtonBusy(true)` immediately — the Stop button is disabled + relabelled "Stopping…" for the duration; `showRecordingControls()` resets it to idle for the next recording. **Error-path symmetry**: `performStop()` guards its slow I/O (metadata write, final sync, ZIP export) individually, but its tail (end-session dispatch, summary build/render) is unguarded and runs _before_ `hideRecordingControls()`. If that tail throws, `handleStopRecording()` catches, calls `setStopButtonBusy(false)` to restore the button (otherwise it would stay stuck disabled + "Stopping…" with the recording controls still on screen — a bricked UI), then **re-throws** so the failure is still reported.
- **Tracking store re-wire on new recording (Finding #1, 2026-05-23 user feedback)**: `handleStartRecording` must call `deps.rebindTrackingStore(newStore)` after `deps.setStore(newStore)`. The WebXR session caches the store reference passed at Enter-AR (initAR `callbacks.tracking.store`); without re-pointing it, every `poseReceived` flows into the orphaned old store and the new store's `tracking.phase` never leaves `'initializing'`, which keeps the tracking-quality HUD pinned to "AR LOST" for the entire recording. Main injects the framework's `rebindTrackingStore` — the one runtime mutation that survived the setter fold.
- **Summary derivation is delegated to a pure helper**: `performStop` gathers all summary inputs (end time, counts, tracker errors, store slices, `gpsEventVisualizer.getAlignmentSnapshotPositions()`, final sync result, resolved ZIP filename) and passes them to `buildSessionSummary` in the sibling `build-session-summary.ts` — a pure function (no I/O, no store access) that returns the `SessionSummaryData` handed to `showSessionSummary`. The math/field-mapping behavior is pinned by that module's own tests; the handler tests keep covering the wiring. See `build-session-summary.ts.md`.
- **Prior ref points load BEFORE the zeroRef wait (A3, 2026-07-06 round-4)**: `loadPriorReferencePoints` calls `deps.loadAndDisplayRefPoints` (OPFS read + store dispatch) first and only then awaits `deps.waitForZeroReference(30000)`. The entries are local and the 2D map needs only lat/lon from the store; only the 3D sphere placement needs GPS (the visualizer is zeroRef-gated internally). On zeroRef timeout the error toast still fires (3D/AR placement is genuinely degraded) but the status reflects both durable facts: `… | GPS unavailable | N ref points (M observations) loaded`.

## Examples

```typescript
import { createRecordingSessionHandlers } from './recording-session-handlers';

const handlers = createRecordingSessionHandlers({
  getStore: () => store,
  setStore: (s) => {
    store = s;
  },
  rebindTrackingStore, // re-point WebXR at the new store (Finding #1)
  setImageQualityAnalyzer: (a) => {
    activeImageQualityAnalyzer = a; // read by the initAR qualityAnalyzer wrapper
  },
  createNewStore: () => createRecorderStore(),
  getRecordingOptions: () => recordingOptions,
  getMapOverlay: () => mapOverlay,
  // (5.7a-3 Option C) clearRefPointUsage dep dropped; per-session usage tracking removed.
  getSessionNotes: () => notesInput.value,
  waitForZeroReference: (ms) => waitForGpsZero(ms),
  loadAndDisplayRefPoints: (h) => loadRefPoints(h),
  collectAndResetErrors: (t) => t.getAndReset(),
  applyAlignmentMatrix: (m) => scene.setMatrix(m),
});

await handlers.handleStartRecording();
// ... recording in progress ...
await handlers.handleStopRecording();
```

## Tests

- `recording-session-handlers.test.ts` — 85 tests covering:
  - Start/stop lifecycle, sensor wiring, storage session creation
  - Sync manager creation and final sync
  - Bug 8 regression: `hideRecordingControls` called before summary transition
  - Bug 12 baseline: documents main-thread ZIP export behavior
  - Build metadata inclusion and best-effort fallback when lookup fails
  - Back-during-recording confirmation flow
  - Write/capture failure tracker proxies
  - Cleanup and full reset
  - **Sentry 7319627943 regression** (`handleStopRecording` describe): a second Stop tap while the first final sync is in flight must not throw and must stop the sync manager + show the summary exactly once; `cleanupForNewRecording` racing the in-flight sync must not double-stop (capture-local defense); the Stop button is marked busy when stopping begins even when the final sync rejects.
- The `setStopButtonBusy` DOM behavior itself is covered in `../ui/hud.test.ts`.
- The summary derivation extracted into `build-session-summary.ts` (distance integration, NUE→GPS snapshot mapping, field assembly) is pinned by `build-session-summary.test.ts` and `build-session-summary.property.test.ts` — the handler suite only asserts the wiring into `showSessionSummary`.
