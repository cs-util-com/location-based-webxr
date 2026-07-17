/**
 * Physics runtime — the mode-independent core shared by the desktop-replay and
 * live-AR paths: a Rapier world + ball session parented under a `WEBXR_TO_NUE`
 * group, a throttled collider rebuild from the growing reconstructed mesh, and a
 * world-space spawn entry point. Both modes drive it identically; only how `step`
 * is ticked (window rAF for replay, the XR frame loop for AR) and how a spawn
 * point is obtained (pointer raycast vs. WebXR hit-test) differ — see the
 * placement abstraction in `main.ts`.
 *
 * Extracting this keeps the two modes from duplicating the physics wiring and
 * makes the spawn → rebuild → step → sync loop headless-testable.
 */

import * as THREE from "three";
import { WEBXR_TO_NUE } from "gps-plus-slam-app-framework/ar/webxr-nue-basis";
import { createPhysicsWorld } from "./physics-world";
import { createPhysicsSession } from "./physics-session";

/**
 * The reconstructed occlusion mesh the collider follows — the SAME mesh the scene
 * renders/occludes with, so physics and occlusion use one building block. The
 * runtime reads its `THREE.Mesh` geometry (raw-WebXR positions, matching the
 * physics space) and builds a Rapier trimesh from it.
 */
export interface OccluderMeshSource {
  getMesh(): THREE.Mesh;
}

/** Extract `{positions, indices}` from an occluder mesh, or null when empty. */
function readTrimesh(
  mesh: THREE.Mesh,
): { positions: Float32Array; indices: Uint32Array } | null {
  const posAttr = mesh.geometry.getAttribute("position");
  const idxAttr = mesh.geometry.getIndex();
  if (!posAttr || !idxAttr || idxAttr.count < 3) return null;
  const positions =
    posAttr.array instanceof Float32Array
      ? posAttr.array
      : new Float32Array(posAttr.array);
  const indices =
    idxAttr.array instanceof Uint32Array
      ? idxAttr.array
      : new Uint32Array(idxAttr.array);
  return { positions, indices };
}

export interface PhysicsRuntimeOptions {
  /** Min delay between collider rebuilds (ms). Default 500 (coalesce, design §6). */
  readonly colliderRebuildMs?: number;
  /** Called after each step with the current ball + collider-box counts. */
  readonly onStats?: (ballCount: number, colliderShapeCount: number) => void;
}

export interface PhysicsRuntime {
  /**
   * Rebuild the trimesh collider from the occluder geometry (throttled to
   * `colliderRebuildMs`), step the world, sync ball meshes, and report stats.
   * `nowMs` is the frame timestamp (rAF / XR frame time) driving the throttle.
   */
  step(nowMs: number): void;
  /**
   * Shoot a ball from a WORLD-space origin with a WORLD-space velocity (both
   * converted into physics space). This is how the demo spawns: a ball leaves the
   * camera and flies toward where the user aimed, then collides with the mesh.
   */
  spawnBallWithVelocity(
    worldOrigin: THREE.Vector3,
    worldVelocity: THREE.Vector3,
  ): void;
  clearBalls(): void;
  ballCount(): number;
  colliderShapeCount(): number;
  dispose(): void;
}

/**
 * Create the runtime. `arWorldGroup` is the scene node carrying the alignment
 * (replay scene or live AR); the balls hang under a `WEBXR_TO_NUE` child of it so
 * they ride the same chain as the reconstructed mesh. `meshSource` is the occlusion
 * mesh whose trimesh becomes the collider (or `null` to run without a collider).
 */
export function createPhysicsRuntime(
  arWorldGroup: THREE.Object3D,
  meshSource: OccluderMeshSource | null,
  options: PhysicsRuntimeOptions = {},
): PhysicsRuntime {
  const colliderRebuildMs = options.colliderRebuildMs ?? 500;
  const physics = createPhysicsWorld();

  const ballGroup = new THREE.Group();
  ballGroup.matrixAutoUpdate = false;
  ballGroup.matrix.copy(WEBXR_TO_NUE);
  arWorldGroup.add(ballGroup);

  const session = createPhysicsSession(physics, ballGroup);
  let lastRebuild = -Infinity;

  return {
    step(nowMs: number): void {
      if (meshSource && nowMs - lastRebuild >= colliderRebuildMs) {
        const trimesh = readTrimesh(meshSource.getMesh());
        if (trimesh) {
          session.setColliderFromTrimesh(trimesh.positions, trimesh.indices);
        }
        lastRebuild = nowMs;
      }
      session.step();
      options.onStats?.(session.ballCount(), session.colliderShapeCount());
    },
    spawnBallWithVelocity(
      worldOrigin: THREE.Vector3,
      worldVelocity: THREE.Vector3,
    ): void {
      ballGroup.updateWorldMatrix(true, false);
      // Origin: a full world→local point transform.
      const localOrigin = ballGroup.worldToLocal(worldOrigin.clone());
      // Velocity is a DIRECTION: transform origin + velocity and subtract, so the
      // group's translation cancels and only its rotation/basis applies (the
      // magnitude is preserved — WEBXR_TO_NUE has no scale).
      const localTip = ballGroup.worldToLocal(
        worldOrigin.clone().add(worldVelocity),
      );
      const localVelocity = localTip.sub(localOrigin);
      session.spawnBallAt(
        { x: localOrigin.x, y: localOrigin.y, z: localOrigin.z },
        { x: localVelocity.x, y: localVelocity.y, z: localVelocity.z },
      );
    },
    clearBalls(): void {
      session.clearBalls();
    },
    ballCount: () => session.ballCount(),
    colliderShapeCount: () => session.colliderShapeCount(),
    dispose(): void {
      session.dispose();
      arWorldGroup.remove(ballGroup);
      physics.dispose();
    },
  };
}
