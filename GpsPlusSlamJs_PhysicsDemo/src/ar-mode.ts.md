# ar-mode.ts

## Purpose

The live-AR mode — a genuine on-device AR physics session (the other half of the
demo; the desktop-replay path lives in `main.ts`). Balls bounce off the room the
device reconstructs live; a tap shoots a ball from the camera along its forward
direction into the room.

## Public API

- **`startArMode(deps): Promise<() => void>`** — starts a WebXR session and returns
  a disposer that ends it. `deps`: `{ container, statsEl, meshStyleSelect,
meshShaderSelect, onError, onStarted?, onFrame?, shadows?, shadowToggle?,
panel? }`. A tap on `panel` does not also shoot: its `beforexrselect` is
  cancelled (a DOM-overlay tap fires the click AND an XR select, and a
  select shoots; OsmDemo's DEC-Y18), removed on dispose; taps on the scene
  still shoot. `onFrame` is called once per XR
  frame (drives the always-on perf panel — the framework's `createPerfStatsOverlay`,
  wired in `main.ts`).

## Behaviour / wiring

- Creates a framework store (`createSlamAppStore` + `NullStorageBackend`), then
  `initAR(container, {}, { requestDepthOcclusion }, { tracking: {store}, depth: {
onCaptured → dispatch recordDepthSample } })`.
- `startDepthCapture({ intervalMs: DEFAULT_RECONSTRUCTION_DEPTH_INTERVAL_MS, gridSize: DEFAULT_RECONSTRUCTION_DEPTH_GRID_SIZE })`
  - `createOccupancyView(arWorldGroup, store)` reconstruct the room from the live
    depth stream (same occupancy stack as replay) at the framework reconstruction
    cadence — the same single tuning source the recorder defaults read (200 ms ×
    gridSize 24 since the 2026-07-16 evening on-device framerate/mesh trade-off),
    so the two apps can never drift apart again. Pinned by `ar-mode.test.ts`.
- `createPhysicsRuntime(arWorldGroup, occlusionMesh)` runs the physics; it is
  stepped every XR frame via `registerXrFrameUpdate` (`performance.now()` drives the
  collider-rebuild throttle).
- Tap-to-shoot: `session`'s `select` (tap) fires `shootBallFromCamera` — a ball
  leaves the camera along its forward direction (`getCamera().getWorldDirection`)
  and flies into the room. No hit-test reticle (removed per user feedback — it
  clipped through the mesh and the ball should go where you look, not sit on a
  surface).
- The mesh-view controller (Cubes/Detailed) is shared with the replay path.
- **AR shadows** (W4 AR shadows plan 2026-09-26-0549 §11; round-2 plan
  2026-09-26-2055 M1): `startDemoShadows`
  (`ar-shadows-wiring.ts`) runs on the session's renderer and scene, fed
  the view's CURRENT occluder (`getOcclusionMesh`) and the ball count. It
  updates in the XR frame callback right after `runtime.step`, so the map
  renders in the same frame as the balls move (no lag), and is disposed with
  the session. It is started even with `?shadows=0` (`deps.shadows` false)
  and then switched off; the panel's switch (`deps.shadowToggle`,
  `bindShadowSwitch`) turns them on and off by intensity, never recompiling.
  The session already renders when this starts, so the lit materials
  recompile once (accepted, plan §8 item 6).
- **The stats line** (round-2 plan M1, the owner's view on the phone):
  `statsText` from `ball-status.ts`, "balls N (k resting, j fell through)
  · collider N tris · shadows on|off|unavailable", the viewer's height from
  the tracked camera.

## Invariants & assumptions

- **Device-only glue.** Playwright Chromium has no `navigator.xr`, so this file is
  NOT exercised by e2e; it is verified manually via `pnpm dev` on an Android phone
  (repo norm for WebXR glue). Its tested building blocks are `occupancy-view`,
  `physics-runtime`, and `mesh-view-controller`.
- `initAR` is a singleton (one session); the disposer calls `endARSession()`.
- The store is created per session (re-passed to `initAR`); no GPS/alignment is
  wired (physics needs only AR-local tracking + depth).

## Tests

- None directly (device-only WebXR glue). Covered indirectly by the unit tests of
  its building blocks; behaviour verified on-device.
