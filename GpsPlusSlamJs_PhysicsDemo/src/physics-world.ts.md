# physics-world.ts

## Purpose

A thin wrapper around a Rapier world for the demo: init the WASM runtime, create a
world, step it, and spawn dynamic sphere bodies. Rapier ships as
`@dimforge/rapier3d-compat` (WASM inlined).

## Public API

- **`initRapier(): Promise<void>`** — initialise the Rapier WASM runtime once
  (idempotent). MUST resolve before any world/collider/body is created.
- **`createPhysicsWorld(options?): PhysicsWorld`** — `{ gravity=DEFAULT_GRAVITY,
timestepS=1/60 }`. Returns `{ rapier, world, step(), dispose() }`.
- **`spawnBall(physics, position, options?): BallBody`** — a dynamic sphere at
  `position` (raw-WebXR); `{ radius=0.08, restitution=0.5, velocity? }`. Returns
  `{ body, radius }` for transform syncing.

## Invariants & assumptions

- **Coordinate basis:** everything is **raw-WebXR** (Y up) — the same space the
  occupancy grid/AABBs live in — so gravity is `(0,-9.81,0)` and no basis change
  is needed between grid, collider and bodies. Rendered balls are parented under a
  `WEBXR_TO_NUE` group (main.ts), the same chain as the mesh, so physics and the
  visible mesh coincide. (Pins design §6 / follow-up F5.)
- **Fixed timestep** (default 1/60) → deterministic, reproducible stepping (the
  headless test relies on it).
- `initRapier()` must be awaited before `createPhysicsWorld()`; `dispose()` frees
  the world.

## Tests

- `physics-world.test.ts` (headless, real Rapier WASM) — a ball dropped above an
  AABB floor rests at ≈ floor-top + radius; without a floor it falls through;
  removing the collider lets a new ball fall through; and a ball rests on a trimesh
  floor too. See `mesh-collider.ts` for the collider builders these use.
