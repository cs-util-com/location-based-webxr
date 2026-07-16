# ar-mode.ts

## Purpose

The live-AR mode — a genuine on-device AR physics session (the other half of the
demo; the desktop-replay path lives in `main.ts`). Balls bounce off the room the
device reconstructs live; a tap shoots a ball from the camera along its forward
direction into the room.

## Public API

- **`startArMode(deps): Promise<() => void>`** — starts a WebXR session and returns
  a disposer that ends it. `deps`: `{ container, statsEl, meshStyleSelect,
meshShaderSelect, onError, onStarted?, onFrame? }`. `onFrame` is called once per XR
  frame (drives the always-on perf panel; see `perf-stats.ts`).

## Behaviour / wiring

- Creates a framework store (`createSlamAppStore` + `NullStorageBackend`), then
  `initAR(container, {}, { requestDepthOcclusion }, { tracking: {store}, depth: {
onCaptured → dispatch recordDepthSample } })`.
- `startDepthCapture({ intervalMs: DEFAULT_RECONSTRUCTION_DEPTH_INTERVAL_MS, gridSize: DEFAULT_RECONSTRUCTION_DEPTH_GRID_SIZE })`
  - `createOccupancyView(arWorldGroup, store)` reconstruct the room from the live
    depth stream (same occupancy stack as replay) at the framework reconstruction
    cadence — recorder parity (32×32 @ 2 Hz; the bare fallback 16×16 @ 1 Hz built
    the mesh 8× slower, 2026-07-16-1547 field feedback). Pinned by `ar-mode.test.ts`.
- `createPhysicsRuntime(arWorldGroup, occlusionMesh)` runs the physics; it is
  stepped every XR frame via `registerXrFrameUpdate` (`performance.now()` drives the
  collider-rebuild throttle).
- Tap-to-shoot: `session`'s `select` (tap) fires `shootBallFromCamera` — a ball
  leaves the camera along its forward direction (`getCamera().getWorldDirection`)
  and flies into the room. No hit-test reticle (removed per user feedback — it
  clipped through the mesh and the ball should go where you look, not sit on a
  surface).
- The mesh-view controller (Cubes/Detailed) is shared with the replay path.

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
