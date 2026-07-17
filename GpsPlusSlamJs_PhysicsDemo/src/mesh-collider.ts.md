# mesh-collider.ts

## Purpose

Turn the framework's reconstructed occupancy geometry into a static Rapier
collider the balls bounce off. The framework stays physics-engine-agnostic (it
emits the AABB list and the `{positions, indices}` trimesh); this demo binds that
geometry to Rapier — the concrete answer to "the developer wires the geometry into
their own physics engine."

## Public API

- **`buildAabbCompoundCollider(physics, aabbs, restitution?): StaticCollider`** —
  one fixed rigid body carrying a cuboid per occupied AABB (`getAabbs()` / mesher
  `aabbs`). `halfExtents` are already half-extents. Cheap, robust, pairs with the
  Cubes mesh view.
- **`buildTrimeshCollider(physics, positions, indices, restitution?): StaticCollider`**
  — one fixed body from the meshed surface. Exact; pairs with the Detailed view.
- **`StaticCollider`** — `{ shapeCount, remove() }`; `remove()` detaches the body
  for a rebuild.

## Invariants & assumptions

- **Raw-WebXR space** — the AABBs and positions already are; the world runs there.
- **AABB vs. trimesh (design §6):** AABB-compound is cheap and incrementally
  rebuildable; the trimesh path is exact but a full rebuild each grid revision is
  costly and can teleport resting balls, so the caller throttles/coalesces
  rebuilds (reuse the framework's `OccluderMeshDriver` coalesce-to-latest) and
  keeps resting bodies asleep across a rebuild.
- `default restitution` 0.35 (moderately bouncy surfaces).

## Tests

- `physics-world.test.ts` — AABB-compound `shapeCount` == AABB count; trimesh
  `shapeCount` == triangle count; a ball rests on both an AABB floor and a trimesh
  floor; `remove()` lets a ball fall through where the floor was.
