# replay-scene.ts

## Purpose

Sets up a standard Three.js rendering environment for desktop replay mode (no WebXR). Creates the scene hierarchy with the `arpose` intermediate node, OWNS the resulting scene objects (exposed via the init return value / `getReplayState()` — never injected into `webxr-session.ts`), and provides orbit + FPS camera controls for inspecting replayed GPS data.

## Public API

| Symbol                 | Signature                                                                       | Description                                    |
| ---------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------- |
| `initReplayScene()`    | `(container: HTMLElement) => { scene, arWorldGroup, arpose, camera, renderer }` | Initialize scene, renderer, controls, rAF loop |
| `disposeReplayScene()` | `() => void`                                                                    | Clean up all resources (idempotent)            |
| `getReplayState()`     | `() => ReplaySceneState \| null`                                                | Internal state for testing/introspection       |
| `updateOrbitTarget()`  | `(position: THREE.Vector3) => void`                                             | Set orbit center + translate camera to follow  |
| `getCameraMode()`      | `() => 'orbit' \| 'fps'`                                                        | Current camera mode                            |
| `toggleCameraMode()`   | `() => void`                                                                    | Switch between orbit and FPS modes             |

## Types

| Type               | Description                                                                             |
| ------------------ | --------------------------------------------------------------------------------------- |
| `CameraMode`       | `'orbit' \| 'fps'`                                                                      |
| `ReplaySceneState` | Internal aggregate: scene, arWorldGroup, arpose, camera, renderer, controls, rAFId, etc |

## Invariants & Assumptions

- **Camera at scene root (Issue 5 fix):** During replay, `initReplayScene()` reparents the camera from
  `arpose` to the scene root. This gives OrbitControls and FPS controls a stable world-space frame,
  unaffected by `arpose` odom pose updates or the alignment matrix on `arWorldGroup`. The `arpose` node
  still receives recorded odom poses (its world position drives the orbit target via `updateOrbitTarget()`).
- **Orbit target follow:** `updateOrbitTarget()` translates the camera by the same delta as the orbit
  target to preserve the viewing relationship. OrbitControls.update() does NOT auto-move the camera when
  the target moves (it recomputes offset = camera.position - target, which is a no-op without user input).
  Without explicit camera translation, the camera would sit still while the trajectory moves away.
- **Scene ownership (surface-reduction step 2, replaces the Risk R1 injection):** `initReplayScene()` keeps its own `scene`/`arWorldGroup`/`arpose`/`camera` references and never writes into `webxr-session.ts` — the live getters (`getScene()` etc.) stay `null` during replay. Replay consumers read the init return value / `getReplayState()`, and the replay orchestrator points scene-reading visualizers at these references explicitly (e.g. `gpsEventVisualizer.setSceneSource(...)`). The historical `setScene`/`setArWorldGroup`/`setCamera`/`setArPose`/`getArPose` exports were deleted.
- **No WebXR:** Renderer has `xr.enabled === false`. Uses `requestAnimationFrame` loop, not WebXR's `setAnimationLoop`.
- **Idempotent dispose:** `disposeReplayScene()` can be called multiple times safely. Clears all module state and DOM references.
- **Single instance:** Only one replay scene can be active. Calling `initReplayScene()` while one exists throws.

## Scene Hierarchy

```
scene (GPS world frame — NUE: X=North, Y=Up, Z=East)
├── camera                           ← reparented to scene root for stable controls (Issue 5)
├── cameraFollower                   ← lerps to camera world position, rotation = identity (Issue 8)
│   └── GPS compass cubes (N, E, S, W, Up)
├── arWorldGroup (NUE local space)   ← alignment matrix written directly here
│   ├── basisChangeNode ('webxr-to-nue', constant WEBXR_TO_NUE, matrixAutoUpdate=false)
│   │   └── arpose (Object3D)        ← receives recorded odom position/rotation (WebXR space)
├── AmbientLight
└── DirectionalLight
```

## Camera Modes

### Orbit (default)

- `OrbitControls` — click-drag to orbit, scroll to zoom, right-drag to pan
- `updateOrbitTarget()` sets the orbit center (call as GPS events arrive)

### FPS (toggle)

- **Drag-based mouse look** (Issue 6): left-click-drag on the canvas rotates the camera (yaw + pitch)
- WASD keyboard handler **scoped to container** (not `document`): W/S forward/backward, A/D strafe, Space up, Shift down. The container receives `tabindex="0"` if missing, and is focused when FPS mode activates.
- **Tabindex save/restore (tagged union):** FPS mode needs `tabindex` on the container for keyboard focus.
  The save/restore state uses an explicit tagged union (`SavedTabindex`) instead of overloading `null`/`undefined`,
  making the "nothing saved" vs "attribute was absent" distinction unambiguous and resistant to `== null` bugs.
- Movement is frame-rate independent: `FPS_MOVE_SPEED` (9 units/sec) multiplied by delta time from `THREE.Clock` each frame
- Pitch clamped to ±(π/2 − 0.01) to prevent gimbal lock
- Switching orbit → FPS preserves the current camera orientation (yaw/pitch extracted from quaternion)
- Toggle with `toggleCameraMode()`

## Examples

```typescript
import {
  initReplayScene,
  disposeReplayScene,
  updateOrbitTarget,
  toggleCameraMode,
} from './replay-scene.js';

// Initialize
const container = document.getElementById('replay-container')!;
const { scene, camera, renderer } = initReplayScene(container);

// Auto-follow GPS events during replay
updateOrbitTarget(new THREE.Vector3(1, 0, 3));

// Switch to FPS mode for detailed inspection
toggleCameraMode();

// Clean up when done
disposeReplayScene();
```

## Tests

- [replay-scene.test.ts](replay-scene.test.ts) — 60 tests covering:
  - **3a (core):** camera reparented to scene root (Issue 5), scene ownership (webxr-session live getters stay null — the R1 injection is gone), arpose exposed via return value/state, renderer config, canvas insertion, sizing, rAF loop, lighting, arWorldGroup parent, double-init guard, dispose cleanup (canvas removal, module state, rAF cancel, renderer disposal), idempotent dispose
  - **3b (orbit):** default mode, updateOrbitTarget sets center, updateOrbitTarget translates camera to follow trajectory, incremental deltas across multiple calls, safe before init
  - **3c (FPS toggle):** orbit→fps, fps→orbit, safe before init, default mode before init, dispose cleans both, tabindex save/restore (single + multi round-trip, pre-existing values, dispose-from-FPS, dispose-without-FPS)
  - **Issue 5:** arpose remains in hierarchy after reparent, camera world position unaffected by arpose changes, camera starts elevated
  - **Issue 6 (drag-based mouse look):** pointer listeners registered on canvas, left-click-drag rotates yaw, left-click-drag rotates pitch, pitch clamping, orientation preserved on mode switch, pointer listener cleanup on mode switch, pointer listener cleanup on dispose, stops rotating after release
  - **Issue 8:** camera-follower at scene root (not arWorldGroup), compass cubes, getCameraFollower getter, dispose cleanup, follower placement
  - **Frame-rate independence:** FPS movement scales with delta time, not frame count
  - **P3 (DOM hardcoding audit):** FPS keyboard listeners are scoped to container (not document), container gets `tabindex` when FPS mode activates

## References

- [docs/2026-02-19-replay-mode.md](../../../GpsPlusSlamJs_Docs/docs/2026-02-19-replay-mode.md) — Issue 4 (scene setup), Issue 5 (camera controls), Risk R1 (historical: the R1 setter injection described there was removed by the 2026-07-11 surface-reduction plan, step 2), R5
- [docs/2026-07-11-1641-webxr-session-surface-reduction-plan.md](../../../GpsPlusSlamJs_Docs/docs/2026-07-11-1641-webxr-session-surface-reduction-plan.md) — step 2: replay owns its scene
- [ar-scene-hierarchy.ts](ar-scene-hierarchy.ts) — `createSceneHierarchy()`, the scene-graph builder replay shares with live AR. Replay no longer imports `webxr-session.ts` at all: the builder was extracted so the desktop path stops pulling in the live-session singleton, XR frame loop and capture subsystems.
- [gps-event-markers.ts](../visualization/gps-event-markers.ts) — `setSceneSource()` (how scene-reading visualizers are pointed at the replay scene)
