/**
 * Physics world — a thin wrapper around a Rapier world for the demo.
 *
 * Rapier ships as `@dimforge/rapier3d-compat` (WASM inlined); `initRapier()` MUST
 * be awaited once before any world/collider/body is created. The world runs in
 * **raw-WebXR space** — the same space the occupancy grid and its AABBs live in
 * (Y is up in WebXR), so gravity is `(0, -9.81, 0)` and no basis change is needed
 * between the grid, the collider and the bodies. The RENDERED balls are parented
 * under a `WEBXR_TO_NUE` group (see main.ts), the same `alignment × WEBXR_TO_NUE`
 * chain as the occlusion mesh, so the physics and the visible mesh coincide.
 * (This pins the coordinate-basis risk from the design §6 / follow-up F5.)
 */

import RAPIER from "@dimforge/rapier3d-compat";

let initPromise: Promise<void> | null = null;

/** Initialise the Rapier WASM runtime (idempotent — safe to await repeatedly). */
export function initRapier(): Promise<void> {
  initPromise ??= RAPIER.init();
  return initPromise;
}

/** Default earth gravity in raw-WebXR space (Y up). */
const DEFAULT_GRAVITY = { x: 0, y: -9.81, z: 0 } as const;

interface PhysicsWorldOptions {
  readonly gravity?: { x: number; y: number; z: number };
  /** Fixed simulation timestep (s). Default 1/60 for deterministic stepping. */
  readonly timestepS?: number;
}

export interface PhysicsWorld {
  /** The Rapier namespace (collider/body descriptors live here). */
  readonly rapier: typeof RAPIER;
  /** The underlying Rapier world. */
  readonly world: RAPIER.World;
  /** Advance the simulation by one fixed timestep. */
  step(): void;
  /** Free the world and all its bodies/colliders. */
  dispose(): void;
}

/**
 * Create a physics world. `initRapier()` must have resolved first (the demo and
 * tests await it before calling this).
 */
export function createPhysicsWorld(
  options: PhysicsWorldOptions = {},
): PhysicsWorld {
  const world = new RAPIER.World(options.gravity ?? DEFAULT_GRAVITY);
  world.timestep = options.timestepS ?? 1 / 60;
  return {
    rapier: RAPIER,
    world,
    step() {
      world.step();
    },
    dispose() {
      world.free();
    },
  };
}

/** A spawned dynamic sphere body (kept so the render loop can sync its mesh). */
export interface BallBody {
  readonly body: RAPIER.RigidBody;
  readonly radius: number;
}

interface SpawnBallOptions {
  readonly radius?: number;
  readonly restitution?: number;
  /** Initial linear velocity (raw-WebXR). */
  readonly velocity?: { x: number; y: number; z: number };
}

/**
 * Spawn a dynamic sphere rigid body at `position` (raw-WebXR). Returns the body
 * + its radius for transform syncing and rendering.
 */
export function spawnBall(
  physics: PhysicsWorld,
  position: { x: number; y: number; z: number },
  options: SpawnBallOptions = {},
): BallBody {
  const { rapier, world } = physics;
  const radius = options.radius ?? 0.08;
  const bodyDesc = rapier.RigidBodyDesc.dynamic().setTranslation(
    position.x,
    position.y,
    position.z,
  );
  const velocity = options.velocity;
  if (velocity) {
    bodyDesc.setLinvel(velocity.x, velocity.y, velocity.z);
  }
  const body = world.createRigidBody(bodyDesc);
  const colliderDesc = rapier.ColliderDesc.ball(radius).setRestitution(
    options.restitution ?? 0.5,
  );
  world.createCollider(colliderDesc, body);
  return { body, radius };
}
