# shoot-ball.ts

## Purpose

The shared spawn action for both modes: shoot a ball from the camera toward where
the user aimed (user feedback — a ball should not appear at the clicked surface; it
should leave the camera and fly into the reconstructed room with momentum).

## Public API

- **`shootBallFromCamera(runtime, cameraWorldPos, direction): void`** — spawn a ball
  `SPAWN_OFFSET_M` (0.3 m) in front of the camera travelling along `direction`
  (world; need not be normalized) at `SHOOT_SPEED`, via
  `runtime.spawnBallWithVelocity`.
- **`SHOOT_SPEED`** — 6 m/s (enough momentum to bounce + roll; tunable).

Desktop passes the camera→pointer ray direction (`THREE.Raycaster`); AR passes the
camera's forward direction (`getWorldDirection`).

## Invariants & assumptions

- Does not mutate the caller's `cameraWorldPos` / `direction` (clones internally).
- Pure w.r.t. the DOM/WebGL — only touches the injected runtime; unit-testable.

## Tests

- `shoot-ball.test.ts` — spawns 0.3 m in front of the camera along the (normalized)
  aim at exactly `SHOOT_SPEED`; does not mutate the input vectors.
