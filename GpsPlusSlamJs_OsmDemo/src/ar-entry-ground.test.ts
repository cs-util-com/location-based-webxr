import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { DESCENT_FALL_S, DESCENT_HOLD_S } from "./ar-descent.js";
import {
  createArEntryGround,
  entryGroundOpacity,
  ENTRY_GROUND_EXTENT_M,
} from "./ar-entry-ground.js";

/**
 * Tests for the AR entry ground (r543).
 *
 * Why these tests matter: this module puts an opaque, screen-filling plane into
 * an AR scene. The failure that matters is not "the fade looks wrong" — it is a
 * plane that OUTLIVES the entry, which turns a passthrough view into a grey lid
 * with no way back. Every test below is about that plane reliably going away.
 */

describe("entryGroundOpacity", () => {
  const START_M = 60;

  it("is fully opaque while the descent holds, so there is a floor to fall towards", () => {
    expect(entryGroundOpacity({ elapsedS: 0, startM: START_M })).toBeCloseTo(
      1,
      5,
    );
    expect(
      entryGroundOpacity({ elapsedS: DESCENT_HOLD_S, startM: START_M }),
    ).toBeCloseTo(1, 5);
  });

  it("reaches EXACTLY zero on landing, and stays there", () => {
    // The property the whole module exists for. Not "close to zero": a plane at
    // 0.01 opacity is still a grey wash over the camera, and it would never be
    // reported as a fade bug — only as "AR looks washed out".
    const landed = DESCENT_HOLD_S + DESCENT_FALL_S;
    expect(entryGroundOpacity({ elapsedS: landed, startM: START_M })).toBe(0);
    expect(
      entryGroundOpacity({ elapsedS: landed + 600, startM: START_M }),
    ).toBe(0);
  });

  it("shows NO ground when there is no descent at all", () => {
    // A session entered from a ground-level 3D view has nothing to fall from,
    // so a floor would just be a lid. Degenerate inputs land on the same side.
    for (const startM of [0, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(entryGroundOpacity({ elapsedS: 0, startM })).toBe(0);
    }
    expect(entryGroundOpacity({ elapsedS: Number.NaN, startM: 60 })).toBe(0);
  });

  it("falls monotonically, never brightening part-way through", () => {
    // A ground that comes BACK mid-descent reads as a rendering fault rather
    // than as a transition.
    let previous = Number.POSITIVE_INFINITY;
    for (let t = 0; t <= DESCENT_HOLD_S + DESCENT_FALL_S; t += 0.05) {
      const value = entryGroundOpacity({ elapsedS: t, startM: START_M });
      expect(value).toBeLessThanOrEqual(previous + 1e-9);
      previous = value;
    }
  });
});

describe("createArEntryGround", () => {
  it("lies flat, so it reads as ground rather than as a wall", () => {
    const ground = createArEntryGround();
    // READ THE GEOMETRY'S OWN NORMAL, not the mesh quaternion.
    //
    // The first version applied the mesh quaternion to (0,0,1) and asserted the
    // result had length 1. The rotation is baked into the GEOMETRY, so the
    // quaternion is identity and that assertion read `expect(1).toBeCloseTo(1)`
    // -- it would have passed with `rotateX(+PI/2)`, i.e. with the plane facing
    // DOWN, which `side: DoubleSide` would then have hidden. Cold review caught
    // it. The flat check (every vertex at y=0) survives both rotations too, so
    // neither half was doing the work the test name claims.
    const positions = ground.mesh.geometry.getAttribute("position");
    const first = new THREE.Vector3().fromBufferAttribute(positions, 0);
    expect(Math.abs(first.y), "the plane is not flat").toBeLessThan(1e-6);
    const normals = ground.mesh.geometry.getAttribute("normal");
    const normal = new THREE.Vector3().fromBufferAttribute(normals, 0);
    expect(normal.y, "the plane faces down, not up").toBeCloseTo(1, 5);
    ground.dispose();
  });

  it("covers enough ground to be read from the descent's starting height", () => {
    const ground = createArEntryGround();
    ground.mesh.geometry.computeBoundingBox();
    const box = ground.mesh.geometry.boundingBox;
    expect(box?.max.x).toBeCloseTo(ENTRY_GROUND_EXTENT_M, 5);
    ground.dispose();
  });

  it("hides itself at zero opacity rather than blending a screen-sized quad", () => {
    const ground = createArEntryGround();
    ground.setOpacity(0.5);
    expect(ground.mesh.visible).toBe(true);
    ground.setOpacity(0);
    expect(ground.mesh.visible).toBe(false);
    ground.dispose();
  });

  it("clamps opacity, and treats a non-finite value as INVISIBLE", () => {
    // The safe direction, deliberately: the failure worth designing against is
    // a plane that stays. A NaN opacity in three.js renders as fully opaque.
    const ground = createArEntryGround();
    ground.setOpacity(Number.NaN);
    expect(ground.mesh.visible).toBe(false);
    ground.setOpacity(5);
    expect((ground.mesh.material as THREE.MeshBasicMaterial).opacity).toBe(1);
    ground.dispose();
  });

  it("does not punch a hole in the city it is drawn over", () => {
    // A transparent plane that writes depth hides everything drawn after it.
    const ground = createArEntryGround();
    const material = ground.mesh.material as THREE.MeshBasicMaterial;
    expect(material.depthWrite).toBe(false);
    expect(material.transparent).toBe(true);
    ground.dispose();
  });

  it("detaches from the scene AND frees its buffers on dispose", () => {
    // Both halves matter: removeFromParent alone leaks a screen-sized geometry
    // per AR session, and disposing without detaching leaves a mesh in the
    // scene whose material has been freed.
    const scene = new THREE.Scene();
    const ground = createArEntryGround();
    scene.add(ground.mesh);
    expect(scene.children).toContain(ground.mesh);

    let geometryDisposed = false;
    ground.mesh.geometry.addEventListener("dispose", () => {
      geometryDisposed = true;
    });
    ground.dispose();

    expect(scene.children).not.toContain(ground.mesh);
    expect(geometryDisposed).toBe(true);
  });

  it("survives a non-finite height instead of vanishing silently", () => {
    const ground = createArEntryGround();
    ground.setHeightM(-60);
    expect(ground.mesh.position.y).toBe(-60);
    ground.setHeightM(Number.NaN);
    expect(ground.mesh.position.y).toBe(0);
    ground.dispose();
  });
});
