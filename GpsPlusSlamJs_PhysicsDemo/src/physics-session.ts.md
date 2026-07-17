# physics-session.ts

## Purpose

Ties the Rapier world to the rendered scene: owns the spawned ball bodies + their
THREE meshes, the current static collider (rebuilt from the reconstructed
occupancy AABBs / trimesh as the walk plays back), and the per-step transform
sync. Factored out of `main.ts` so the spawn → step → rest → render loop is
headless-testable (real Rapier + real THREE objects, no WebGL/rAF).

## Public API

- **`createPhysicsSession(physics, ballParent, options?): PhysicsSession`** —
  `options.maxAgeSteps` (default 3600 = 60 s at the 1/60 s timestep) auto-despawns a
  ball that many steps after it spawned.
  - `spawnBallAt(position, velocity?)` — dynamic sphere at `position` (raw-WebXR),
    rendered as a `THREE.Mesh` under `ballParent`.
  - `clearBalls()` / `ballCount()`.
  - `setColliderFromAabbs(aabbs)` / `setColliderFromTrimesh(positions, indices)` —
    rebuild the static collider (removes the previous one). `colliderKind()` →
    `'aabb' | 'trimesh' | null`, `colliderShapeCount()`.
  - `step()` — advance the world one fixed step and sync every ball mesh to its
    body translation.
  - `dispose()` — clear balls, remove the collider, free the shared geometry.

## Invariants & assumptions

- **Raw-WebXR positions.** `ballParent` must carry `WEBXR_TO_NUE` under
  `arWorldGroup` (main.ts) so the balls ride the same chain as the mesh.
- **Rebuild replaces, never stacks** — each `setCollider*` removes the previous
  collider body first, so the collider count reflects the latest geometry only.
- **Auto-despawn** is counted in fixed physics steps (not wall-clock), so it is
  deterministic and testable; `step` prunes balls older than `maxAgeSteps`.
- Shared unit-sphere geometry + one material across balls (each mesh scaled to its
  radius); freed on `dispose`.
- `initRapier()` must have resolved before the `physics` world was created.

## Tests

- `physics-session.test.ts` (headless) — after stepping, the ball MESH position
  equals its body translation and rests at ≈ floor-top + radius on an AABB
  collider; `clearBalls` removes bodies + meshes; rebuilding switches the collider
  kind (AABB → trimesh) and a ball still rests on the new one.
