/**
 * Why this test matters (owner feedback round 2, plan 2026-09-26-2055 M1):
 * a ball must come to REST on the reconstructed floor, in every mesh mode
 * the demo offers, or no shadow ever stays on the floor to be seen. This
 * builds the same OcclusionMesh the demo builds, from a flat slab of
 * occupied cells, turns its geometry into the physics collider exactly as
 * the runtime does, and drops a ball on it at a cell's centre, a quarter,
 * an edge and a corner (where a trimesh's internal edges bite): in every
 * mode it must come to REST, above the floor and all but still. (On the
 * replay fixture's very sparse room, 238 vertices, a ball dropped on the
 * "Surface nets" or "Corner-fit" floor fell through while "Cubes" held it,
 * measured 2026-09-26; this test shows a clean floor holds in every mode,
 * which points at that data's gaps, not proves it.)
 */

import * as THREE from "three";
import { beforeAll, describe, expect, it } from "vitest";
import type { GridCell } from "gps-plus-slam-app-framework/ar/bresenham3d";
import { OcclusionMesh } from "gps-plus-slam-app-framework/visualization/occlusion-mesh";

import { buildTrimeshCollider } from "./mesh-collider";
import { createPhysicsWorld, initRapier, spawnBall } from "./physics-world";

beforeAll(async () => {
  await initRapier();
});

const CELL_M = 0.16;
const RADIUS_M = 0.08;

/** A 2 m x 2 m floor slab, one cell thick, its cells' top at y = 0. */
function slab(): GridCell[] {
  const cells: GridCell[] = [];
  for (let x = -6; x <= 6; x++) {
    for (let z = -6; z <= 6; z++) cells.push([x, -1, z]);
  }
  return cells;
}

describe("a ball on the reconstructed floor", () => {
  for (const mode of ["smooth", "greedy", "corner-fit"] as const) {
    it(`comes to rest on a "${mode}" floor`, () => {
      const occluder = new OcclusionMesh(new THREE.Group(), { mode });
      // The cell centre, for "corner-fit" (the others ignore it). Cast: the
      // framework's declarations carry their own copy of three's Vector3.
      const cellPoint = (cell: GridCell) =>
        new THREE.Vector3(
          (cell[0] + 0.5) * CELL_M,
          (cell[1] + 0.5) * CELL_M,
          (cell[2] + 0.5) * CELL_M,
        );
      occluder.update(
        slab(),
        CELL_M,
        cellPoint as unknown as Parameters<OcclusionMesh["update"]>[2],
      );
      const geometry = occluder.getMesh().geometry;
      const index = geometry.getIndex();
      expect(index).not.toBeNull();
      const positions = geometry.getAttribute("position").array as Float32Array;
      const physics = createPhysicsWorld();
      buildTrimeshCollider(physics, positions, index!.array as Uint32Array);
      // The floor's top surface, as the mesh drew it, under the drop point.
      const box = new THREE.Box3().setFromBufferAttribute(
        geometry.getAttribute("position") as THREE.BufferAttribute,
      );
      // A cell's centre, a quarter, an edge and a corner (cells are
      // CELL_M wide from 0; the slab spans cells -6..6).
      for (const [fx, fz] of [
        [0.5, 0.5],
        [0.25, 0.25],
        [0, 0.5],
        [0, 0],
      ] as const) {
        const ball = spawnBall(
          physics,
          { x: fx * CELL_M, y: box.max.y + 0.3, z: fz * CELL_M },
          { radius: RADIUS_M },
        );
        for (let i = 0; i < 300; i++) physics.step();
        const where = `${mode} at (${fx}, ${fz}) of a cell`;
        expect(ball.body.translation().y, where).toBeGreaterThan(box.max.y);
        const v = ball.body.linvel();
        expect(Math.hypot(v.x, v.y, v.z), where).toBeLessThan(0.05);
        physics.world.removeRigidBody(ball.body);
      }
      physics.dispose();
      occluder.dispose();
    });
  }
});
