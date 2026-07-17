# replay-session.ts

## Purpose

Framework-level composer that lets any consumer app replay a recorded session on
the desktop (no phone, no WebXR) with live mesh reconstruction, in a handful of
lines — instead of copying the RecorderApp's `replay/replay-mode.ts` orchestrator.
It is the entry point the `GpsPlusSlamJs_PhysicsDemo` (and any future physics/AR
app) builds its desktop-replay harness on (2026-07-15 replay-as-dev-harness Part A).

## Public API

- **`startReplaySession(options): ReplaySessionController`** — synchronous; the
  caller drives playback via the returned controller.
  - `options.actions: ReplayAction[]` — the already-loaded recorded action list.
    The loader stays a consumer concern; for a current-era zip use the framework's
    `loadActionsFromZip` (storage/zip-reader). The framework does **not** migrate
    old-era recordings (dependency direction — see the 2026-05-19 loader doc).
  - `options.container: HTMLElement` — receives the desktop replay canvas.
  - `options.store?: SlamAppStore` — defaults to a fresh framework store with
    `NullStorageBackend` and `enableDevChecks:false` (high-throughput replay).
    Inject only to add app slices; it MUST carry the framework recording slice.
  - `options.occupancy?: ReplayOccupancyConfig` — `{ enabled=true, cellSizeM=0.15,
minObservations=1, showCubes=true, showOcclusionMesh=true, refreshIntervalMs=250 }`.
  - `options.onProgress?/onComplete?/onError?` — forwarded to the `ReplayEngine`.
- **`ReplaySessionController`** — `play(speedFactor=1)`, `pause()`, `resume()`,
  `setSpeed(factor)`, `getState()`, `getStore()`, `getScene()` (→ `{scene,
arWorldGroup, arpose, camera, renderer}`), `getOccupancyGrid()` (or `null`),
  `getCubesVisualizer()` (or `null`), `getOcclusionMesh()` (or `null`),
  `getActionCount()`, `dispose()`. The cubes + occlusion-mesh handles let a
  consumer's mesh-view controller toggle visibility/style live.

## Invariants & assumptions

- **Composes existing pieces only:** `initReplayScene` (non-WebXR desktop scene),
  `wireStoreSubscribers` (alignment lerp + GPS event markers + recorded odom pose
  → `arpose`), `OccupancyGrid` + `OccupancyCubesVisualizer` + `OcclusionMesh` fed
  by the replayed depth stream (`subscribeReplayOccupancy`), and a `ReplayEngine`.
- **GPS-marker singleton:** points `gpsEventVisualizer` at the replay scene on
  start and restores it (`setSceneSource(null)`) on `dispose`, so a later live AR
  session is unaffected. Only one replay session may be active at a time (the
  scene + lerper + marker singletons are module-global — same constraint as the
  RecorderApp's replay mode).
- **Coordinate frames:** cubes/occlusion mesh carry `WEBXR_TO_NUE` under
  `arWorldGroup` (raw-WebXR cells in an NUE-aligned node); `onNewOdomPose`
  converts the recorded NUE pose back to WebXR for `arpose`.
- **Not wired here:** recorder-specific frame tiles, ref-point spheres/markers,
  and the stats overlay — those the RecorderApp injects into its own orchestrator.
- **Occupancy refresh** is throttled (`subscribeReplayOccupancy`); the occlusion
  mesh is meshed synchronously on the main thread via `OcclusionMesh.update` (no
  worker) — adequate for desktop replay.

## Examples

```ts
import { startReplaySession } from 'gps-plus-slam-app-framework/state/replay-session';
import { loadActionsFromZip } from 'gps-plus-slam-app-framework/storage/zip-reader';

const entries = await loadActionsFromZip(zipBytes);
const session = startReplaySession({
  actions: entries.map((e) => e.action),
  container: document.getElementById('viewport')!,
});
await session.play(1);
// physics consumer: session.getOccupancyGrid(), session.getScene().arWorldGroup
session.dispose();
```

## Tests

- `replay-session.test.ts` — controller surface; a replayed `recordDepthSample`
  folds into the grid and refreshes the cubes (with the sample's head pose);
  occupancy-disabled builds no grid; dispose tears down the scene, restores the
  GPS-marker scene source, and detaches the occupancy subscriber. The WebGL scene
  (`initReplayScene`) and the NUE↔WebXR converters are mocked (jsdom has no GL).
