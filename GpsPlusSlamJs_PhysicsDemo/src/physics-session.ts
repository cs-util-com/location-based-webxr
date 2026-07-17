/**
 * Physics session — ties the Rapier world to the rendered scene: owns the spawned
 * ball bodies + their THREE meshes, the current static collider (rebuilt from the
 * reconstructed occupancy AABBs as the walk plays back), and the per-step
 * transform sync. Factored out of `main.ts` so the spawn → step → rest → render
 * loop is headless-testable (real Rapier + real THREE objects, no WebGL/rAF).
 *
 * All positions are raw-WebXR (the space `physics-world` runs in); the caller
 * parents `ballParent` under a `WEBXR_TO_NUE` node so the balls ride the same
 * `alignment × WEBXR_TO_NUE` chain as the occlusion mesh and visually coincide.
 */

import * as THREE from "three";
import type { Aabb } from "gps-plus-slam-app-framework/ar/occupancy-mesher";
import { spawnBall, type PhysicsWorld, type BallBody } from "./physics-world";
import {
  buildAabbCompoundCollider,
  buildTrimeshCollider,
  type StaticCollider,
} from "./mesh-collider";

/** Which collider shape mirrors the visible mesh style (design principle). */
type ColliderKind = "aabb" | "trimesh";

interface Ball {
  readonly body: BallBody;
  readonly mesh: THREE.Mesh;
  /** The step index this ball was spawned at (for age-based auto-despawn). */
  readonly bornAtStep: number;
}

interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

interface PhysicsSession {
  /** Spawn a ball at `position` (raw-WebXR) with an optional initial velocity. */
  spawnBallAt(position: Vec3, velocity?: Vec3): void;
  /** Remove every ball (body + mesh). */
  clearBalls(): void;
  ballCount(): number;
  /** Rebuild the static AABB-compound collider from the current occupied AABBs. */
  setColliderFromAabbs(aabbs: readonly Aabb[]): void;
  /** Rebuild the static trimesh collider from the current mesh geometry. */
  setColliderFromTrimesh(positions: Float32Array, indices: Uint32Array): void;
  /** Which collider kind is currently built (for the "visible mirrors collider" rule). */
  colliderKind(): ColliderKind | null;
  colliderShapeCount(): number;
  /** Step the world once and sync every ball mesh to its body. */
  step(): void;
  dispose(): void;
}

const BALL_COLOR = 0x4f8cff;

export interface PhysicsSessionOptions {
  /**
   * Auto-despawn a ball after this many `step`s. Default 3600 — 60 s at the fixed
   * 1/60 s timestep. Counting steps (not wall-clock) keeps it deterministic + testable.
   */
  readonly maxAgeSteps?: number;
}

export function createPhysicsSession(
  physics: PhysicsWorld,
  ballParent: THREE.Object3D,
  options: PhysicsSessionOptions = {},
): PhysicsSession {
  const maxAgeSteps = options.maxAgeSteps ?? 3600;
  const balls: Ball[] = [];
  let stepCount = 0;
  // One shared unit sphere; each ball mesh is scaled to its radius.
  const geometry = new THREE.SphereGeometry(1, 16, 12);
  const material = new THREE.MeshStandardMaterial({ color: BALL_COLOR });
  let collider: StaticCollider | null = null;
  let kind: ColliderKind | null = null;

  const removeBall = (ball: Ball): void => {
    ballParent.remove(ball.mesh);
    physics.world.removeRigidBody(ball.body.body);
  };

  const clearBalls = (): void => {
    for (const ball of balls) removeBall(ball);
    balls.length = 0;
  };

  return {
    spawnBallAt(position: Vec3, velocity?: Vec3): void {
      const radius = 0.08;
      // Omit `velocity` entirely when absent (exactOptionalPropertyTypes).
      const body = spawnBall(
        physics,
        position,
        velocity ? { radius, velocity } : { radius },
      );
      const mesh = new THREE.Mesh(geometry, material);
      mesh.scale.setScalar(radius);
      mesh.position.set(position.x, position.y, position.z);
      ballParent.add(mesh);
      balls.push({ body, mesh, bornAtStep: stepCount });
    },
    clearBalls,
    ballCount: () => balls.length,
    setColliderFromAabbs(aabbs: readonly Aabb[]): void {
      collider?.remove();
      collider = buildAabbCompoundCollider(physics, aabbs);
      kind = "aabb";
    },
    setColliderFromTrimesh(
      positions: Float32Array,
      indices: Uint32Array,
    ): void {
      collider?.remove();
      collider = buildTrimeshCollider(physics, positions, indices);
      kind = "trimesh";
    },
    colliderKind: () => kind,
    colliderShapeCount: () => collider?.shapeCount ?? 0,
    step(): void {
      stepCount++;
      physics.step();
      // Sync surviving balls; auto-despawn any older than maxAgeSteps. Iterate
      // backwards so splicing removed balls doesn't skip the next one.
      for (let i = balls.length - 1; i >= 0; i--) {
        const ball = balls[i]!;
        if (stepCount - ball.bornAtStep > maxAgeSteps) {
          removeBall(ball);
          balls.splice(i, 1);
          continue;
        }
        const t = ball.body.body.translation();
        ball.mesh.position.set(t.x, t.y, t.z);
      }
    },
    dispose(): void {
      clearBalls();
      collider?.remove();
      collider = null;
      kind = null;
      geometry.dispose();
      material.dispose();
    },
  };
}
