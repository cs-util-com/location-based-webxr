# replay-mode.ts

## Purpose

Orchestrates all replay building blocks (Iterations 1-5) into a single entry point for desktop replay mode. Loads actions from a zip file, creates a store, initializes the Three.js scene, wires store subscribers, and returns a controller for the UI.

## Public API

### `startReplayMode(zipData, config): Promise<ReplayModeController>`

| Parameter           | Type                       | Description                         |
| ------------------- | -------------------------- | ----------------------------------- |
| `zipData`           | `Uint8Array`               | Raw zip file bytes                  |
| `config.container`  | `HTMLElement`              | DOM element for the Three.js canvas |
| `config.onProgress` | `(current, total) => void` | Progress callback                   |
| `config.onComplete` | `() => void`               | Completion callback                 |
| `config.onError`    | `(index, error) => void`   | Per-action error callback (R7)      |

### `ReplayModeController`

| Method              | Signature                             | Description                                                                                                                                                                                 |
| ------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `play(speedFactor)` | `(number) => Promise<void>`           | Start dispatching actions at the given speed                                                                                                                                                |
| `pause()`           | `() => void`                          | Pause the replay                                                                                                                                                                            |
| `resume()`          | `() => Promise<void>`                 | Resume from where we paused                                                                                                                                                                 |
| `setSpeed(factor)`  | `(number) => void`                    | Change playback speed mid-replay                                                                                                                                                            |
| `getState()`        | `() => ReplayState`                   | Get current engine state                                                                                                                                                                    |
| `getEngine()`       | `() => ReplayEngine`                  | Get the underlying engine                                                                                                                                                                   |
| `getStore()`        | `() => RecorderStore`                 | Get the replay store (R6: same instance)                                                                                                                                                    |
| `getActionCount()`  | `() => number`                        | Total number of loaded actions                                                                                                                                                              |
| `setMapOverlay(o)`  | `(LeafletMapOverlay \| null) => void` | Set/clear the real map overlay target for the proxy (forwards setGpsPosition, render) and refresh the store-driven ref-point markers onto the just-attached map (via its `getLeafletMap()`) |
| `dispose()`         | `() => void`                          | Clean up scene, engine, and subscribers                                                                                                                                                     |

## Invariants & Assumptions

- **R6 (Store identity):** The same `RecorderStore` instance is passed to `wireStoreSubscribers()` and `ReplayEngine.play()`. This ensures dispatched actions trigger visualization updates.
- **R7 (Error handling):** `onError` from config is wired to `ReplayEngine.onError()`. Dispatch errors don't crash the loop.
- **R8 (Data flow):** `loadActionsFromZip(zipData)` → maps each entry's `.action` → `ReplayAction[]` → `engine.play()`.
- Store uses `NullStorageBackend` — no persistence side effects during replay.
- **Compass opt-ins are disabled for the replay store** (`enableCompassColdStartOverride`/`RotationPrior`/`WebXRConsistency` all `false`). Replay's source of truth is the recorded action stream: a session recorded WITH an opt-in on already carries the `set…Enabled(true)` action (persisted after the first `setZeroPos`), which replay re-applies. Only ENABLED opt-ins are persisted, so leaving the framework defaults (cold-start override defaults ON) would auto-enable an override a session recorded WITHOUT — breaking replay fidelity for e.g. §6a calibration captures. Disabling the auto-apply replays both on/off cases faithfully.
- **R9 / Issue #3 (Orbit auto-follow):** `onNewGpsPosition` is intentionally **not** wired. The orbit target is now driven by `onAlignmentSnapshot` (Issue #3), which fires when alignment-matrix changes create a snapshot. The snapshot NUE position ($A_k \cdot p_k$) is in scene-root space and is passed directly to `updateOrbitTarget()`. This centers the orbit camera on the system's best-estimate GPS position (coinciding with the visible red snapshot spheres) rather than tracking every odom pose.
- **6.2 (AR pose replay):** `onNewOdomPose` callback writes recorded `odomPosition`/`odomRotation` to the replay scene's own `arpose` Object3D (`replaySceneState.arpose`, returned by `initReplayScene()` — webxr-session's `getArPose()` was deleted with the rest of the replay injection surface, 2026-07-11 surface-reduction step 2) each time a new GPS event is dispatched. Positions are converted from NUE to WebXR space via `nueToWebXR()` before setting arpose.position, and rotations via `nueQuaternionToWebXR()` before setting arpose.quaternion, because `applyAlignmentMatrix()` composes the alignment with `WEBXR_TO_NUE`. Both are imported from `gps-plus-slam-app-framework/ar/nue-webxr-conversions`, which re-exports the library's canonical implementations — the recorder deliberately keeps `gps-plus-slam-app-framework` as its only direct dependency. They replaced webxr-session's `nuePositionToWebXR`/`nueQuaternionToWebXR`, which widened the tuple parameters to `readonly number[]` and `as`-cast them back; this callback no longer annotates its own parameters, so they infer as `Vector3`/`Quaternion` from `StoreSubscriberDeps` and no widening is needed. This ensures `(alignment × W2N) × arpose_WebXR = alignment × odom_NUE` for both position and rotation. The `onNewOdomPose` callback no longer updates the orbit target — that responsibility moved to `onAlignmentSnapshot` (Issue #3).
- `initReplayScene()` is called once; `disposeReplayScene()` is called on dispose.
- **Replay scene ownership (surface-reduction step 2):** the replay scene is never injected into the webxr-session singleton — its live getters stay `null` during replay. `startReplayMode` therefore points the scene-reading singleton visualizers at the replay references right after `initReplayScene()`: `gpsEventVisualizer.setSceneSource({ getScene, getArWorldGroup })` (replay scene + arWorldGroup) and `refPointVisualizer.setSceneSource(() => scene)`. `dispose()` restores both to the live default (`setSceneSource(null)`) BEFORE `disposeReplayScene()`, so no marker can be parented into a disposed scene and a later live AR session gets the default wiring back.
- **Best-effort visual layers:** the frame-tile visualizer (F3.5) and the occupancy-grid cubes (2026-06-11 depth occupancy-grid port plan, Iter 5) are each wired inside their own `try/catch` — a failure (e.g. zip without `frames/`, WebGL issue) logs a warning and replay continues without that layer. Re-dispatched `recordDepthSample` actions rebuild the voxel grid via `wireOccupancyGridSubscribers`; recordings made before intrinsics capture have no `projectionMatrix`, so their grid simply stays empty. The cube visualizer is parented under `replaySceneState.arWorldGroup` (NOT the scene root) because the grid's cells are raw-WebXR coordinates that must ride the alignment matrix like the recorded camera path (port plan Iter 7). Both layers are torn down in `dispose()`.
- **Perf stats overlay (Step 0 of the 2026-07-03 long-session fps plan):** when `visualization.statsOverlay` is on (the one visualization toggle that applies to replay too), a Stats.js FPS/ms/MB panel row (the framework's `createPerfStatsOverlay`, `gps-plus-slam-app-framework/visualization/perf-stats-overlay`) mounts into `config.container`, driven by its own `requestAnimationFrame` loop (the framework's replay render loop is module-private; rAF fires once per browser frame, so the measured cadence equals the render cadence). Best-effort like the other layers; the rAF loop is cancelled and the overlay disposed in `dispose()`. Grid-size telemetry (`onGridSize`, ~30 s `[OccupancyGrid] <n> cells` log) is wired on the occupancy subscriber for replay parity with live.
- The `mapOverlay` subscriber dep is a **proxy** that delegates to a late-bound real overlay via `setMapOverlay()`. This allows store subscribers to forward map updates to the overlay even though the overlay is created lazily by `handleReplayMapToggle`. The proxy forwards two overlay methods: `setGpsPosition` (recenter) and `render` (the unified `MapData` trajectory snapshot). Each method uses optional chaining on the target so calls are silently dropped when no real overlay is bound.
- **Ref-point markers are store-driven, not proxied** (2026-07-05 live-map feedback): `wireRefPointMapMarkers` ([ui/ref-point-map-markers.ts](../ui/ref-point-map-markers.md)) renders the replay store's `refPoints` state onto the overlay's Leaflet map (`getLeafletMap()`, late-bound via `setMapOverlay`, which refreshes) through the SAME renderer as the live and summary maps. The replayed `startSession` action carries the original session's start time, so its captures render red and imported sidecar points green. Torn down in `dispose()`.

## Examples

```typescript
import { startReplayMode } from './replay-mode.js';

const zipBytes = new Uint8Array(await file.arrayBuffer());
const controller = await startReplayMode(zipBytes, {
  container: document.getElementById('replay-container')!,
  onProgress: (current, total) => updateUI(`Action ${current}/${total}`),
  onComplete: () => showToast('Replay complete'),
  onError: (index, err) => showToast(`Action ${index} failed: ${err.message}`),
});

await controller.play(5); // 5x speed
controller.setSpeed(10); // change to 10x mid-replay
controller.pause();
await controller.resume();
controller.dispose();
```

## Tests

- Unit tests: [replay-mode.test.ts](replay-mode.test.ts) — covering:
  - Data flow: zip → actions → store (R8)
  - Scene initialization with container
  - Visualizer scene-source wiring (points `gpsEventVisualizer`/`refPointVisualizer` at the replay scene; dispose restores the live default)
  - Store identity for subscribers (R6)
  - Controller API shape
  - Action count
  - Play dispatches to store
  - Progress and complete callbacks
  - Dispose lifecycle
  - Error handling wiring (R7)
  - Pause/resume
  - Speed changes
  - `setMapOverlay` proxy delegation, null clearing, forwarding of `render` (MapData), and the ref-point map-marker wiring (late-binding `getLeafletMap`, refresh on attach, unsubscribe on dispose)
