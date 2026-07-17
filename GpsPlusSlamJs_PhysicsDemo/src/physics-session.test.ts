/**
 * Headless tests for the physics session (real Rapier + real THREE objects).
 *
 * Why this test matters:
 * This is the seam that makes the visible balls track the simulation and the
 * collider follow the reconstructed mesh. It pins the two things the render loop
 * depends on: after stepping, each ball MESH position equals its body's
 * translation (so what you see is where the physics is), and a rebuilt collider
 * replaces the previous one (so the walked-in geometry actually stops the balls).
 * A dropped ball must come to rest on the AABB collider at ≈ radius above the
 * floor — the end-to-end "balls settle on real surfaces" promise, mesh-side.
 */

import { describe, it, expect, beforeAll } from "vitest";
import * as THREE from "three";
import { initRapier, createPhysicsWorld } from "./physics-world";
import { createPhysicsSession } from "./physics-session";
import type { Aabb } from "gps-plus-slam-app-framework/ar/occupancy-mesher";

const FLOOR: readonly Aabb[] = [
  { center: [0, -0.075, 0], halfExtents: [5, 0.075, 5] },
];

beforeAll(async () => {
  await initRapier();
});

describe("createPhysicsSession", () => {
  it("syncs the ball mesh to the body and rests it on the AABB collider", () => {
    const physics = createPhysicsWorld();
    const parent = new THREE.Group();
    const session = createPhysicsSession(physics, parent);
    session.setColliderFromAabbs(FLOOR);
    session.spawnBallAt({ x: 0, y: 1.5, z: 0 });

    expect(session.ballCount()).toBe(1);
    // The mesh is in the scene graph under the ball parent.
    expect(parent.children).toHaveLength(1);

    for (let i = 0; i < 300; i++) session.step();

    // The rendered mesh tracks the simulation and rests at ≈ floor-top + radius.
    const meshY = parent.children[0]!.position.y;
    expect(meshY).toBeGreaterThan(0);
    expect(meshY).toBeCloseTo(0.08, 1);
    session.dispose();
    physics.dispose();
  });

  it("auto-despawns a ball after maxAgeSteps steps", () => {
    const physics = createPhysicsWorld();
    const parent = new THREE.Group();
    const session = createPhysicsSession(physics, parent, { maxAgeSteps: 5 });
    session.spawnBallAt({ x: 0, y: 1, z: 0 });
    expect(session.ballCount()).toBe(1);

    // Alive through maxAgeSteps steps...
    for (let i = 0; i < 5; i++) session.step();
    expect(session.ballCount()).toBe(1);
    expect(parent.children).toHaveLength(1);

    // ...and despawned (body + mesh removed) on the step past maxAgeSteps.
    session.step();
    expect(session.ballCount()).toBe(0);
    expect(parent.children).toHaveLength(0);
    session.dispose();
    physics.dispose();
  });

  it("clearBalls removes every body and mesh", () => {
    const physics = createPhysicsWorld();
    const parent = new THREE.Group();
    const session = createPhysicsSession(physics, parent);
    session.spawnBallAt({ x: 0, y: 1, z: 0 });
    session.spawnBallAt({ x: 1, y: 1, z: 0 });
    expect(session.ballCount()).toBe(2);

    session.clearBalls();

    expect(session.ballCount()).toBe(0);
    expect(parent.children).toHaveLength(0);
    session.dispose();
    physics.dispose();
  });

  it("rebuilding the collider replaces the previous one and tracks its kind", () => {
    const physics = createPhysicsWorld();
    const session = createPhysicsSession(physics, new THREE.Group());
    expect(session.colliderKind()).toBeNull();

    session.setColliderFromAabbs(FLOOR);
    expect(session.colliderKind()).toBe("aabb");
    expect(session.colliderShapeCount()).toBe(1);

    // Switch to a trimesh floor — the AABB body must be gone (a ball still rests).
    const positions = new Float32Array([
      -2, 0, -2, 2, 0, -2, 2, 0, 2, -2, 0, 2,
    ]);
    const indices = new Uint32Array([0, 1, 2, 0, 2, 3]);
    session.setColliderFromTrimesh(positions, indices);
    expect(session.colliderKind()).toBe("trimesh");
    expect(session.colliderShapeCount()).toBe(2);

    session.spawnBallAt({ x: 0, y: 1, z: 0 });
    for (let i = 0; i < 300; i++) session.step();
    expect(session.ballCount()).toBe(1);
    session.dispose();
    physics.dispose();
  });
});
