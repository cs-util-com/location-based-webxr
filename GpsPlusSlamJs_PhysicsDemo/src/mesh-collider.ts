/**
 * Mesh collider — turn the framework's reconstructed occupancy geometry into a
 * static Rapier collider the balls bounce off.
 *
 * The framework stays physics-engine-agnostic: it emits geometry (the AABB list
 * from `OcclusionMesh.getAabbs()` / mesher `aabbs`, and the `{positions, indices}`
 * trimesh), and THIS demo binds it to Rapier. Two collider shapes, per the design:
 *   - **AABB-compound** — one fixed body with a cuboid per occupied AABB. Cheap,
 *     robust, incrementally rebuildable. Pairs with the Cubes mesh view.
 *   - **Trimesh** — one fixed body from the meshed surface. Exact, but a full
 *     rebuild each grid revision is costly and can teleport resting balls; the
 *     caller throttles/coalesces rebuilds (see the churn note in the design §6).
 *
 * Everything is in **raw-WebXR space** (the AABBs and positions already are), the
 * same space `physics-world` runs in.
 */

import type { Aabb } from "gps-plus-slam-app-framework/ar/occupancy-mesher";
import type { PhysicsWorld } from "./physics-world";

/** A static collider bound into the world; `remove()` detaches it for a rebuild. */
export interface StaticCollider {
  /** Number of collider shapes attached (cuboids for AABB, triangles for trimesh). */
  readonly shapeCount: number;
  /** Remove the collider body and all its shapes from the world. */
  remove(): void;
}

/** Default restitution (bounciness) of the reconstructed surfaces. */
const DEFAULT_RESTITUTION = 0.35;

/**
 * Build an AABB-compound collider: one fixed rigid body carrying a cuboid collider
 * per occupied AABB (`halfExtents` are already half-extents, exactly what Rapier's
 * `cuboid` wants).
 */
export function buildAabbCompoundCollider(
  physics: PhysicsWorld,
  aabbs: readonly Aabb[],
  restitution: number = DEFAULT_RESTITUTION,
): StaticCollider {
  const { rapier, world } = physics;
  const body = world.createRigidBody(rapier.RigidBodyDesc.fixed());
  for (const aabb of aabbs) {
    const desc = rapier.ColliderDesc.cuboid(
      aabb.halfExtents[0],
      aabb.halfExtents[1],
      aabb.halfExtents[2],
    )
      .setTranslation(aabb.center[0], aabb.center[1], aabb.center[2])
      .setRestitution(restitution);
    world.createCollider(desc, body);
  }
  return {
    shapeCount: aabbs.length,
    remove() {
      world.removeRigidBody(body);
    },
  };
}

/**
 * Build a trimesh collider from the mesher's `{positions, indices}` (transferable
 * typed arrays). One fixed body, one trimesh collider.
 */
export function buildTrimeshCollider(
  physics: PhysicsWorld,
  positions: Float32Array,
  indices: Uint32Array,
  restitution: number = DEFAULT_RESTITUTION,
): StaticCollider {
  const { rapier, world } = physics;
  const body = world.createRigidBody(rapier.RigidBodyDesc.fixed());
  const desc = rapier.ColliderDesc.trimesh(positions, indices).setRestitution(
    restitution,
  );
  world.createCollider(desc, body);
  return {
    shapeCount: indices.length / 3,
    remove() {
      world.removeRigidBody(body);
    },
  };
}
