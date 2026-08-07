# store-subscribers.ts

## Purpose

Reusable store subscriber wiring extracted from `main.ts` (Iteration 4, Risk R2 fix). Connects Redux-like store state changes to visualization dependencies: alignment matrix application, GPS event markers, and 2D map overlay. Both the live recording path and the desktop replay path call `wireStoreSubscribers()` with the same interface.

Uses `subscribeToSelector` for selective change detection — each state slice (alignment matrix, GPS positions, reference points) has its own subscription that only fires when that specific value changes by reference equality. This replaces the manual `lastX` tracking variables from the original design.

## Public API

| Symbol                 | Signature                                                                                                                                                                                  | Description                                                              |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| `wireStoreSubscribers` | `(store: SubscribableStore, deps: StoreSubscriberDeps) => () => void`                                                                                                                      | Subscribe to store changes and drive visualizers. Returns unsubscribe.   |
| `SubscribableStore`    | `{ getState, subscribe }` interface                                                                                                                                                        | Minimal store contract — satisfied by `RecorderStore` and replay stores. |
| `StoreSubscriberDeps`  | `{ applyAlignmentMatrix, gpsEventVisualizer, mapOverlay?, refPointVisualizer?, onNewGpsPosition?, onNewOdomPose?, onAlignmentSnapshot?, onNewGpsLatLng?, showAccuracySpheres? }` interface | Injected dependencies for visualization updates.                         |

### `mapOverlay` dependency (optional)

- `setGpsPosition(lat, lon)` — called on GPS-position changes to center the map on the **same coordinate the blue dot shows**: the rebuilt `MapData.userPosition` (fused tip when an alignment exists, raw fix before the first solve). For a **render-less** overlay (minimal `setGpsPosition`-only shape) there is no rebuilt snapshot, so centering keeps the last raw fix. See [2026-07-06-1526-recorder-live-map-user-dot-fused-pose-user-feedback.md](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-07-06-1526-recorder-live-map-user-dot-fused-pose-user-feedback.md) decisions 3, 5, 6.
- `render?(data: MapData)` — draws the full shared trajectory snapshot (raw GPS + accuracy circles, fused path, alignment snapshots, user dot) via the shared `drawMapData` routine.
- The previous incremental API (`addRawGpsPoint` / `addFusedPoint` / `addAlignmentSnapshot` / `addRefPoint`) **no longer exists** — the fused path recomputes wholesale from the latest matrix on every rebuild (D2, unified-trajectory-map Phase 3), and ref points are recorder-owned.

### `wireStoreSubscribers(store, deps)`

On each state change the subscriber:

1. **Alignment matrix** — uses `selectAlignmentMatrix` selector (via `subscribeToSelector`) to detect when alignment changes. Calls `deps.applyAlignmentMatrix(matrix)` only when the matrix reference changes. This sets `arWorldGroup.matrix`, and fused markers (children of `arWorldGroup`) update their world positions automatically via scene-graph propagation.
2. **Alignment snapshots** — triggered by the same alignment matrix subscription. When the matrix changes and odometry positions exist, computes $A_k \cdot p_k$ (alignment × latest odom) using `gl-matrix` and calls `deps.gpsEventVisualizer.addAlignmentSnapshot(transformedPos)`. Also calls `deps.onAlignmentSnapshot?.(transformedPos)` so replay mode can update the orbit camera target (Issue #3). This creates a red sphere capturing the system's instantaneous GPS belief.
3. **GPS event markers** — incrementally adds markers for new GPS events (since the last notification). Sets the zero reference on the visualizer when first available.
4. **Orbit target** — if `deps.onNewGpsPosition` is provided, calls it with the GPS world-space coordinates of each new event. Used in replay mode to auto-follow `OrbitControls` (Risk R9).
5. **AR pose update** — if `deps.onNewOdomPose` is provided, calls it with `(odomPosition, odomRotation)` for each new event that has both position and rotation data. Used in replay mode to update the `arpose` Object3D so the camera follows the recorded trajectory.
6. **Map overlay** — on every GPS-positions or alignment-matrix change, `rebuildMap()` rebuilds the full `MapData` snapshot via `buildMapData` (D2: fused path always recomputed from the latest matrix) and hands it to `deps.mapOverlay.render`. On GPS changes it then centers via `setGpsPosition` on the rebuilt snapshot's `userPosition` — the same coordinate the blue dot shows (fused when aligned, raw before the first solve; raw also for a render-less overlay, which has no snapshot). Alignment-change redraws intentionally do **not** re-center (centering stays a GPS-event-rate concern). Skipped entirely if `mapOverlay` is `null`/`undefined`.
7. **GPS lat/lng callback** — if `deps.onNewGpsLatLng` is provided, calls it with `(lat, lng)` for each new GPS event. Used in live recording to drive ref-point proximity detection for the dynamic button label.
8. **GPS accuracy ellipsoid (rec31 investigation §3)** — when `deps.showAccuracySpheres === true`, each new GPS event additionally forwards `{ horizontal: gpsPoint.latLongAccuracy, vertical: gpsPoint.altitudeAccuracy }` to `addGpsEvent`. The visualizer then renders the raw-GPS marker as a non-uniform-scaled ellipsoid (see `../visualization/gps-event-markers.ts` §Marker Sizing). When the flag is `false`/omitted (the live-recording default), `undefined` is forwarded and the legacy fixed 8 cm sphere is drawn. See [../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-19-investigate-rec31-altitude-drop.md](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-19-investigate-rec31-altitude-drop.md).
9. **Reference-point visualization (Finding 5, 2026-04-30)** — if `deps.refPointVisualizer` is provided, two additional subscriptions are wired:
   - `selectPriorRefPointMarks` → `displayPriorRefPoints(priorMarks)`. Fires whenever `priorMarks` changes by reference, replacing the green-sphere set wholesale.
   - `selectCurrentRefPointMarks` → `addCurrentRefPoint(mark)`. Append-only with a high-water-mark counter (`lastCurrentMarksLen`). When the array shrinks (e.g., `clearCurrentRefPointMarks` on scenario reset), the counter is reset to 0 so subsequent re-adds render again.
     Call sites no longer call `refPointVisualizer.displayPriorRefPoints` / `addCurrentRefPoint` directly — they dispatch `setPriorRefPointMarks` / `addCurrentRefPointMark` instead. See [docs/2026-04-30-refpoint-marks-into-redux-plan.md](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-04-30-refpoint-marks-into-redux-plan.md).

Each call creates **fresh selector subscriptions** scoped to that call — no manual reset needed between sessions.

Returns an unsubscribe function that removes all listeners from the store.

## Invariants & Assumptions

- `gpsPositions` and `odometryPositions` arrays grow monotonically (append-only).
- A GPS event at index `i` is only visualized once (tracked by the per-subscription counter).
- `mapOverlay` may be `null` in replay mode or before AR session starts — handled gracefully.
- `onNewGpsLatLng` is optional — provided in live recording mode for dynamic-button proximity detection.
- `showAccuracySpheres` defaults to `false`. Live recording leaves it unset (large ellipsoids would be distracting on the operator screen). Replay mode sets it `true` so the diagnostic ellipsoid is visible alongside the fused cyan marker.
- `onNewGpsPosition` is optional — not provided in live recording mode (camera is XR-controlled). In replay mode, the caller passes a callback that drives `updateOrbitTarget()` from `replay-scene.ts`.
- `onNewOdomPose` is optional — not provided in live recording mode (arpose stays at identity). In replay mode, the caller passes a callback that writes recorded odom position/rotation to the `arpose` Object3D. Skipped defensively if `odometryRotations[i]` is missing.
- `onAlignmentSnapshot` is optional — not provided in live recording mode. In replay mode, the caller passes a callback that routes the snapshot NUE position to `updateOrbitTarget()` in `replay-scene.ts`, centering the orbit camera on alignment-snapshot points (Issue #3).
- The `applyAlignmentMatrix` function and `gpsEventVisualizer`/`mapOverlay` methods are called synchronously during the store notification. No async operations.
- **A throwing `mapOverlay.render` is contained** (PR #168 review): `rebuildMap()` wraps the consumer-supplied `render` in a try/catch (warn-logged) and still returns the built `MapData`, so `setGpsPosition` centering proceeds and the exception cannot escape the store listener — an uncaught subscriber throw would break the whole dispatch chain for that action, recurring on every GPS tick.
- The `LatLong` type is `{ lat: number; lon: number }` from `gps-plus-slam-js`.

## Examples

### Live recording (in main.ts)

```typescript
import { wireStoreSubscribers } from './state/store-subscribers';

// After creating store and initializing storage:
unsubscribeStore = wireStoreSubscribers(store, {
  applyAlignmentMatrix,
  gpsEventVisualizer,
  mapOverlay,
});

// On cleanup:
unsubscribeStore();
```

### Replay mode (future — Iteration 6)

```typescript
import { wireStoreSubscribers } from './state/store-subscribers';

const replayStore = createSlamAppStore({
  storageBackend: new NullStorageBackend(),
});
const unsub = wireStoreSubscribers(replayStore, {
  applyAlignmentMatrix,
  gpsEventVisualizer,
  mapOverlay: null, // no map during replay (or provide one)
  onNewGpsPosition: (coords) => updateOrbitTarget(new THREE.Vector3(...coords)),
});

// Replay engine dispatches actions → subscribers react → markers appear
replayEngine.play(actions, replayStore);

// On cleanup:
unsub();
```

## Tests

Covered by `store-subscribers.test.ts` (47 test cases):

- Subscription lifecycle: subscribe, unsubscribe, no callbacks after unsubscribe
- Alignment matrix: applied when present, updates fused markers, skipped when gpsData null
- GPS event visualization: sets zero ref, incremental marker addition, skips incomplete data
- Orbit target auto-follow: calls onNewGpsPosition with coordinates, last event with multiple, safe when callback absent (Risk R9)
- Map overlay centering (2026-07-06 fused-dot Slice B): centers on the rendered `MapData.userPosition` (fused ≠ raw when aligned), on the raw fix without alignment, on the raw fix for a render-less overlay; handles null overlay gracefully, skips empty positions
- Map overlay rendering: full `MapData` snapshot per store change (raw path, fused path recomputed per matrix — snaps, empty when matrix/zeroRef missing —, alignment-snapshot GPS coords, `userHeadingDeg` wiring), safe when `render` absent; a **throwing** `render` is contained (centering still runs, nothing escapes the listener)
- `showAccuracySpheres` flag (rec31 §3): flag on → forwards `{ horizontal, vertical }` from `latLongAccuracy`/`altitudeAccuracy`; flag off/default → forwards `undefined`; partial accuracy fields preserved (e.g. `altitudeAccuracy` missing → `vertical: undefined`)
- Fresh counter: each `wireStoreSubscribers()` call starts from 0

## Related Files

- [subscribe-to-selector.ts](subscribe-to-selector.ts) — `subscribeToSelector` utility, `SubscribableStore` interface
- [app-selectors.ts](app-selectors.ts) — memoized selectors for alignment matrix, GPS positions, etc.
- [combined-root-state.ts](combined-root-state.ts) — `CombinedRootState`
- [../visualization/map-data.ts](../visualization/map-data.ts) — `buildMapData`, `MapData` (the snapshot this module forwards to map consumers)
- Consumer: the RecorderApp's `main.ts` (live recording path)
