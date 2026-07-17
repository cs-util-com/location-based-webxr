/**
 * Headless physics-core tests (real Rapier WASM in node — no browser, no WebGL).
 *
 * Why this test matters:
 * The whole demo rests on "balls bounce off the reconstructed mesh and settle on
 * real surfaces." That is exactly what this pins deterministically: a ball
 * dropped above an AABB-compound floor built from the framework's occupancy AABBs
 * comes to rest at ≈ floor-top + radius (fixed timestep → reproducible), and does
 * NOT fall through — while removing the collider lets it fall through again. It
 * also pins the collider shape counts (AABB-compound and trimesh). If the
 * coordinate basis were wrong (gravity sideways, collider in the wrong space) the
 * rest position would be wrong and this fails.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { initRapier, createPhysicsWorld, spawnBall } from "./physics-world";
import {
  buildAabbCompoundCollider,
  buildTrimeshCollider,
} from "./mesh-collider";
import type { Aabb } from "gps-plus-slam-app-framework/ar/occupancy-mesher";

// A 10×0.15×10 floor slab whose TOP face is at y = 0 (raw-WebXR, Y up).
const FLOOR_AABBS: readonly Aabb[] = [
  { center: [0, -0.075, 0], halfExtents: [5, 0.075, 5] },
];

beforeAll(async () => {
  await initRapier();
});

/** Step the world to a settled state (a few seconds at the fixed timestep). */
function settle(
  physics: ReturnType<typeof createPhysicsWorld>,
  steps = 300,
): void {
  for (let i = 0; i < steps; i++) physics.step();
}

describe("physics core — ball rests on the reconstructed floor", () => {
  it("a ball dropped above the floor comes to rest at ≈ floor-top + radius", () => {
    const physics = createPhysicsWorld();
    buildAabbCompoundCollider(physics, FLOOR_AABBS);
    const ball = spawnBall(physics, { x: 0, y: 1.5, z: 0 }, { radius: 0.1 });

    settle(physics);
    const y = ball.body.translation().y;

    expect(y).toBeGreaterThan(0); // did NOT fall through the floor
    expect(y).toBeCloseTo(0.1, 1); // rests near floor-top (0) + radius (0.1)
    physics.dispose();
  });

  it("without a floor the ball keeps falling well below the origin (control)", () => {
    const physics = createPhysicsWorld();
    const ball = spawnBall(physics, { x: 0, y: 1.5, z: 0 }, { radius: 0.1 });
    settle(physics);
    expect(ball.body.translation().y).toBeLessThan(-1);
    physics.dispose();
  });

  it("removing the collider lets a new ball fall through where the floor was", () => {
    const physics = createPhysicsWorld();
    const floor = buildAabbCompoundCollider(physics, FLOOR_AABBS);
    floor.remove();
    const ball = spawnBall(physics, { x: 0, y: 1.5, z: 0 }, { radius: 0.1 });
    settle(physics);
    expect(ball.body.translation().y).toBeLessThan(0);
    physics.dispose();
  });
});

describe("collider builders", () => {
  it("AABB-compound reports one cuboid shape per AABB", () => {
    const physics = createPhysicsWorld();
    const aabbs: readonly Aabb[] = [
      { center: [0, 0, 0], halfExtents: [1, 1, 1] },
      { center: [2, 0, 0], halfExtents: [1, 1, 1] },
      { center: [0, 0, 2], halfExtents: [1, 1, 1] },
    ];
    expect(buildAabbCompoundCollider(physics, aabbs).shapeCount).toBe(3);
    physics.dispose();
  });

  it("trimesh reports the triangle count from the index buffer", () => {
    const physics = createPhysicsWorld();
    // Two triangles (a quad) → 6 indices.
    const positions = new Float32Array([0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1]);
    const indices = new Uint32Array([0, 1, 2, 0, 2, 3]);
    expect(buildTrimeshCollider(physics, positions, indices).shapeCount).toBe(
      2,
    );
    physics.dispose();
  });

  it("a ball rests on a trimesh floor too", () => {
    const physics = createPhysicsWorld();
    // A flat 4×4 quad at y = 0.
    const positions = new Float32Array([
      -2, 0, -2, 2, 0, -2, 2, 0, 2, -2, 0, 2,
    ]);
    const indices = new Uint32Array([0, 1, 2, 0, 2, 3]);
    buildTrimeshCollider(physics, positions, indices);
    const ball = spawnBall(physics, { x: 0, y: 1, z: 0 }, { radius: 0.1 });
    settle(physics);
    expect(ball.body.translation().y).toBeCloseTo(0.1, 1);
    physics.dispose();
  });
});
