/**
 * Headless tests for the shared physics runtime (real Rapier + real THREE).
 *
 * Why this test matters:
 * Both the desktop-replay and live-AR modes drive this one runtime, so its two
 * mode-independent behaviours are pinned here: (1) the collider is rebuilt from
 * the growing mesh only once per throttle window (coalescing the fast grid growth
 * so resting balls are not teleported every frame), and (2) a WORLD-space spawn
 * point is converted into the ball group's local raw-WebXR space via the
 * `WEBXR_TO_NUE` chain — the conversion that makes AR/desktop spawns land where
 * the user pointed and coincide with the reconstructed mesh.
 */

import { describe, it, expect, beforeAll } from "vitest";
import * as THREE from "three";
import { WEBXR_TO_NUE } from "gps-plus-slam-app-framework/ar/webxr-nue-basis";
import { initRapier } from "./physics-world";
import {
  createPhysicsRuntime,
  type OccluderMeshSource,
} from "./physics-runtime";

/** A quad (2 triangles) at y=0; the trimesh source the collider follows. */
function quad(): { positions: Float32Array; indices: Uint32Array } {
  return {
    positions: new Float32Array([-2, 0, -2, 2, 0, -2, 2, 0, 2, -2, 0, 2]),
    indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
  };
}

/** A mutable occluder-mesh source so a test can grow the reconstructed mesh. */
function meshSource(
  initial: { positions: Float32Array; indices: Uint32Array } | null,
): OccluderMeshSource & {
  set(data: { positions: Float32Array; indices: Uint32Array }): void;
} {
  const mesh = new THREE.Mesh(new THREE.BufferGeometry());
  const apply = (
    data: { positions: Float32Array; indices: Uint32Array } | null,
  ): void => {
    if (!data) return;
    mesh.geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(data.positions, 3),
    );
    mesh.geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));
  };
  apply(initial);
  return { getMesh: () => mesh, set: apply };
}

beforeAll(async () => {
  await initRapier();
});

describe("createPhysicsRuntime", () => {
  it("rebuilds the trimesh collider from the mesh source only once per throttle window", () => {
    const arWorldGroup = new THREE.Group();
    const source = meshSource(quad()); // 2 triangles
    const runtime = createPhysicsRuntime(arWorldGroup, source, {
      colliderRebuildMs: 500,
    });

    runtime.step(0); // first step rebuilds (throttle satisfied from -Infinity)
    expect(runtime.colliderShapeCount()).toBe(2); // triangles

    // Grow the mesh to 4 triangles; a step INSIDE the window must NOT pick it up.
    source.set({
      positions: new Float32Array([
        -2, 0, -2, 2, 0, -2, 2, 0, 2, -2, 0, 2, 0, 2, 0, 4, 2, 0,
      ]),
      indices: new Uint32Array([0, 1, 2, 0, 2, 3, 4, 5, 0, 4, 0, 1]),
    });
    runtime.step(100);
    expect(runtime.colliderShapeCount()).toBe(2);

    // A step past the window rebuilds to the new geometry.
    runtime.step(600);
    expect(runtime.colliderShapeCount()).toBe(4);
    runtime.dispose();
  });

  it("shoots a ball from a WORLD origin with a WORLD velocity (both converted to local)", () => {
    const arWorldGroup = new THREE.Group(); // identity → ball group world = WEBXR_TO_NUE
    const runtime = createPhysicsRuntime(arWorldGroup, null); // no floor → free flight

    // A reference node with the same WEBXR_TO_NUE transform maps KNOWN local
    // origin/direction into world space; the runtime must round-trip them back.
    const ref = new THREE.Group();
    ref.matrixAutoUpdate = false;
    ref.matrix.copy(WEBXR_TO_NUE);
    ref.updateWorldMatrix(false, false);
    const worldOrigin = ref.localToWorld(new THREE.Vector3(0, 5, 0));
    // Local +X velocity, 3 m/s (WEBXR_TO_NUE has no translation, so localToWorld
    // of a vector is a pure basis change → a world direction).
    const worldVelocity = ref.localToWorld(new THREE.Vector3(3, 0, 0));

    runtime.spawnBallWithVelocity(worldOrigin, worldVelocity);

    const ballMesh = arWorldGroup.children[0]!.children[0]!;
    // Spawns at the local origin.
    expect(ballMesh.position.x).toBeCloseTo(0, 5);
    expect(ballMesh.position.y).toBeCloseTo(5, 5);

    for (let i = 0; i < 10; i++) runtime.step(i * 16);
    // The velocity carried it in +X, and gravity pulled it down a little.
    expect(ballMesh.position.x).toBeGreaterThan(0.3);
    expect(ballMesh.position.y).toBeLessThan(5);
    runtime.dispose();
  });

  it("clears balls and reports stats via onStats", () => {
    const arWorldGroup = new THREE.Group();
    let lastBalls = -1;
    const runtime = createPhysicsRuntime(arWorldGroup, meshSource(quad()), {
      onStats: (balls) => {
        lastBalls = balls;
      },
    });
    const zero = new THREE.Vector3(0, 0, 0);
    runtime.spawnBallWithVelocity(new THREE.Vector3(0, 1, 0), zero);
    runtime.spawnBallWithVelocity(new THREE.Vector3(0, 1, 0), zero);
    expect(runtime.ballCount()).toBe(2);

    runtime.step(0);
    expect(lastBalls).toBe(2); // onStats saw the balls

    runtime.clearBalls();
    expect(runtime.ballCount()).toBe(0);
    runtime.dispose();
  });
});
