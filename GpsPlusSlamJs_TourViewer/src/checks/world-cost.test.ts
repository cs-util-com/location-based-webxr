import { describe, expect, it } from "vitest";
import {
  BoxGeometry,
  BufferGeometry,
  Group,
  InstancedMesh,
  Line,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Points,
  Sprite,
} from "three";

import { poseKey, worldCost } from "./world-cost.js";

const material = new MeshBasicMaterial();

describe("what a world part costs to draw", () => {
  // Why: the lab's cost readout is how a prototype is held to the per-item
  // budget, so it must count what the renderer would draw: one call per
  // visible mesh, its triangles, an instanced mesh's triangles per instance.
  it("counts a call per shown mesh and its triangles, instances included", () => {
    const root = new Group();
    root.add(new Mesh(new BoxGeometry(), material)); // 12 triangles
    root.add(new Mesh(new PlaneGeometry(1, 1, 2, 1), material)); // 4
    const motes = new InstancedMesh(new PlaneGeometry(), material, 5); // 2 x 5
    root.add(motes);
    const hidden = new Mesh(new BoxGeometry(), material);
    hidden.visible = false;
    root.add(hidden);
    const inHidden = new Group();
    inHidden.visible = false;
    inHidden.add(new Mesh(new BoxGeometry(), material));
    root.add(inHidden);
    expect(worldCost(root)).toEqual({ calls: 3, triangles: 26 });
  });

  it("counts an unindexed geometry by its vertices", () => {
    const geometry = new BoxGeometry().toNonIndexed();
    expect(worldCost(new Mesh(geometry, material))).toEqual({
      calls: 1,
      triangles: 12,
    });
  });

  // Why: three draws a mesh with a list of materials once per geometry
  // group, so a box in six materials is six calls, not one; the same box
  // in one material is one call whatever groups its geometry carries.
  it("counts a call per material group of a mesh drawn in several materials", () => {
    const box = new BoxGeometry(); // six groups, 12 triangles
    const six = Array.from({ length: 6 }, () => new MeshBasicMaterial());
    expect(worldCost(new Mesh(box, six))).toEqual({ calls: 6, triangles: 12 });
    expect(worldCost(new Mesh(box, material))).toEqual({
      calls: 1,
      triangles: 12,
    });
    // A group whose material index names no material is not drawn, nor
    // are its triangles.
    const two = new BoxGeometry();
    two.clearGroups();
    two.addGroup(0, 18, 0);
    two.addGroup(18, 18, 5);
    expect(worldCost(new Mesh(two, [material]))).toEqual({
      calls: 1,
      triangles: 6,
    });
  });

  // Why: points, lines and sprites are draw calls too (motes, outlines,
  // labels); a part made of them must not read as free. They add no
  // triangles but a sprite, which is a quad.
  it("counts points, lines and sprites as calls", () => {
    const root = new Group();
    const dots = new BufferGeometry().setFromPoints([]);
    root.add(new Points(dots));
    root.add(new Line(new BufferGeometry()));
    root.add(new LineSegments(new BufferGeometry()));
    root.add(new Sprite());
    expect(worldCost(root)).toEqual({ calls: 4, triangles: 2 });
  });

  it("costs nothing for an empty part", () => {
    expect(worldCost(new Group())).toEqual({ calls: 0, triangles: 0 });
  });
});

describe("whether a world part moved", () => {
  // Why: a part in the editor must stand still. The lab compares this key
  // between two frames, so any move of any object under the part, and only
  // a move, must change it.
  it("changes with any object's position, turn or size, and not otherwise", () => {
    const root = new Group();
    const inner = new Group();
    const leaf = new Mesh(new BoxGeometry(), material);
    inner.add(leaf);
    root.add(inner);
    const still = poseKey(root);
    expect(poseKey(root)).toBe(still);
    for (const move of [
      () => leaf.position.setX(0.01),
      () => inner.rotation.set(0, 0.01, 0),
      () => leaf.scale.setScalar(1.01),
    ]) {
      move();
      expect(poseKey(root)).not.toBe(still);
      leaf.position.set(0, 0, 0);
      inner.rotation.set(0, 0, 0);
      leaf.scale.setScalar(1);
      expect(poseKey(root)).toBe(still);
    }
  });
});
