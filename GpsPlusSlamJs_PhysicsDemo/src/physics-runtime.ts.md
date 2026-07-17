# physics-runtime.ts

## Purpose

The mode-independent physics core shared by the desktop-replay and live-AR paths:
a Rapier world + ball session parented under a `WEBXR_TO_NUE` group, a throttled
collider rebuild from the growing reconstructed mesh, and a world-space spawn
entry point. Both modes drive it identically; only how `step` is ticked (window
rAF for replay, the XR frame loop for AR) and how a spawn point is obtained
(pointer raycast vs. WebXR hit-test) differ.

## Public API

- **`createPhysicsRuntime(arWorldGroup, meshSource, options?): PhysicsRuntime`** —
  `meshSource` is the occlusion mesh (`{ getMesh(): THREE.Mesh }`) or `null`.
  Options: `{ colliderRebuildMs=500, onStats? }`. The collider is a Rapier
  **trimesh** built from the occluder's own geometry (raw-WebXR positions), so
  physics and the visual occlusion use the SAME mesh (user feedback M3).
- **`PhysicsRuntime`** — `step(nowMs)` (throttled collider rebuild + world step +
  mesh sync + `onStats`), `spawnBallWithVelocity(worldOrigin, worldVelocity)`
  (converts a WORLD origin + velocity into the ball group's local raw-WebXR space
  and spawns a moving ball — the "shoot from the camera" primitive), `clearBalls()`,
  `ballCount()`, `colliderShapeCount()`, `dispose()`.

## Invariants & assumptions

- Balls hang under a `WEBXR_TO_NUE` child of `arWorldGroup`, so they ride the same
  `alignment × WEBXR_TO_NUE` chain as the reconstructed mesh (visual coincidence).
- Collider rebuilt at most once per `colliderRebuildMs` (coalesce; design §6).
- `nowMs` is the frame timestamp driving the throttle (rAF `t` / `performance.now`).
- `initRapier()` must have resolved before this is created (the caller awaits it).

## Tests

- `physics-runtime.test.ts` (headless, real Rapier + THREE) — collider rebuilt only
  once per throttle window as the AABB source grows; a WORLD origin + velocity
  round-trip to the ball-group-local space (the ball spawns at the origin and the
  velocity carries it in the aimed direction under gravity); clear + `onStats`.
