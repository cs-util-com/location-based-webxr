import * as THREE from "three";
import { describe, expect, it } from "vitest";

import type { TreePlacement, TreeVariant } from "../mesh/trees.js";
import {
  repackTreeLod,
  TREE_LOD_NEAR_M,
  TREE_LOD_REPACK_M,
  trunkTreeObjects,
} from "./trunk-trees.js";

/**
 * The trunk-and-crown trees (an option, off by default): the woodland prototype's
 * lifted crown on a 5-sided trunk, drawn in two levels by distance (near
 * within 120 m), re-sorted only when the eye has moved 2 m. These pin the
 * triangle budget per tree, the true total height, the split into near and
 * far, and that a still camera costs no work.
 */

function placement(
  x: number,
  y: number,
  variant: TreeVariant,
  heightM = 10,
): TreePlacement {
  return {
    feature: `node/${Math.round(x * 1000 + y)}`,
    position: { x, y },
    groundHeightM: 2,
    heightM,
    crownDiameterM: 6,
    rotationY: 0,
    variant,
    colour: 0x447744,
  };
}

const triangles = (geometry: THREE.BufferGeometry): number =>
  (geometry.index?.count ?? geometry.getAttribute("position").count) / 3;

type Mesh = THREE.InstancedMesh;
const find = (objects: Mesh[], part: string, level: string): Mesh[] =>
  objects.filter(
    (m) => m.userData["treePart"] === part && m.userData["treeLevel"] === level,
  );

describe("trunkTreeObjects", () => {
  // The cost the option was accepted at (the woodland prototype): near 52
  // triangles for a broad or untagged tree and 38 for a needle tree, far 26
  // and 16.
  it("costs the woodland prototype's triangles per tree, near and far", () => {
    const perTree = (variant: TreeVariant, level: string): number => {
      const objects = trunkTreeObjects([placement(0, 0, variant)]);
      return find(objects, "crown", level)
        .concat(find(objects, "trunk", level))
        .reduce((sum, mesh) => sum + triangles(mesh.geometry), 0);
    };
    expect([
      perTree("broadleaved", "near"),
      perTree("broadleaved", "far"),
    ]).toEqual([52, 26]);
    expect([perTree("unknown", "near"), perTree("unknown", "far")]).toEqual([
      52, 26,
    ]);
    expect([
      perTree("needleleaved", "near"),
      perTree("needleleaved", "far"),
    ]).toEqual([38, 16]);
  });

  it("makes a crown and a trunk mesh per level for each form present, on shared resources", () => {
    const objects = trunkTreeObjects([
      placement(0, 0, "broadleaved"),
      placement(5, 0, "needleleaved"),
    ]);
    expect(objects).toHaveLength(8);
    for (const mesh of objects) {
      expect(mesh.userData["sharedResources"]).toBe(true);
      expect(mesh.userData["treeForm"]).toBe("trunk");
      // `count` changes under three, so its bounds are never right.
      expect(mesh.frustumCulled).toBe(false);
      // Nothing drawn before the first repack.
      expect(mesh.count).toBe(0);
    }
    const again = trunkTreeObjects([placement(0, 0, "broadleaved")]);
    expect(again[0]!.geometry).toBe(objects[0]!.geometry);
    expect(trunkTreeObjects([])).toEqual([]);
  });

  // The true height stays the tree's height: the crown sits on the trunk
  // and the two together reach `heightM`, the trunk running a quarter of the
  // way into the crown so no gap shows between them.
  it("lifts the crown onto the trunk and keeps the true height", () => {
    const objects = trunkTreeObjects([placement(0, 0, "broadleaved", 20)]);
    for (const mesh of objects) repackTreeLod(mesh, { x: 0, y: 10, z: 0 });
    const [crown] = find(objects, "crown", "near");
    const [trunk] = find(objects, "trunk", "near");
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    crown!.getMatrixAt(0, m);
    m.decompose(p, q, s);
    const crownBase = 20 * 0.35;
    expect(p.y).toBeCloseTo(2 + crownBase, 5);
    expect(s.y).toBeCloseTo(20 - crownBase, 5);
    trunk!.getMatrixAt(0, m);
    m.decompose(p, q, s);
    expect(p.y).toBeCloseTo(2, 5);
    expect(s.y).toBeCloseTo(crownBase + 0.25 * (20 - crownBase), 5);
    // The girth fallback: 0.012 x height + 0.06, within 0.1-0.35 m.
    expect(s.x).toBeCloseTo(0.3, 5);
  });

  // Every tree is drawn exactly once, in the level its distance gives it.
  it("puts the trees within 120 m of the eye near and the rest far", () => {
    const list = [0, 50, 110, 130, 400].map((x) =>
      placement(x, 0, "broadleaved", 10),
    );
    const objects = trunkTreeObjects(list);
    // The eye level with the crowns' middle (ground 2 + 5).
    const eye = { x: 0, y: 7, z: 0 };
    for (const mesh of objects) repackTreeLod(mesh, eye);
    const near = find(objects, "crown", "near")[0]!;
    const far = find(objects, "crown", "far")[0]!;
    expect(near.count).toBe(3);
    expect(far.count).toBe(2);
    expect(find(objects, "trunk", "near")[0]!.count).toBe(3);
    expect(find(objects, "trunk", "far")[0]!.count).toBe(2);
    expect(TREE_LOD_NEAR_M).toBe(120);
  });

  // A still or creeping camera costs nothing: the instances are re-sorted
  // only after the eye has moved 2 m since the last sort.
  it("re-sorts only after the eye has moved 2 m", () => {
    const objects = trunkTreeObjects([placement(0, 0, "broadleaved")]);
    const mesh = objects[0]!;
    expect(repackTreeLod(mesh, { x: 0, y: 0, z: 0 })).toBe(true);
    expect(repackTreeLod(mesh, { x: 1.9, y: 0, z: 0 })).toBe(false);
    expect(repackTreeLod(mesh, { x: 0, y: 1.5, z: 1.2 })).toBe(false);
    expect(repackTreeLod(mesh, { x: 2.1, y: 0, z: 0 })).toBe(true);
    expect(TREE_LOD_REPACK_M).toBe(2);
    // A mesh this module did not make is left alone.
    const foreign = new THREE.InstancedMesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial(),
      1,
    );
    expect(repackTreeLod(foreign, { x: 0, y: 0, z: 0 })).toBe(false);
  });

  // The eye is taken in the mesh's own frame: a consumer may move the city
  // under a parent, and the distance is in the city's metres.
  it("repacks before its render with the camera in its own frame", () => {
    const objects = trunkTreeObjects([placement(300, 0, "broadleaved")]);
    const parent = new THREE.Group();
    parent.position.set(-300, 0, 0);
    for (const mesh of objects) parent.add(mesh);
    parent.updateMatrixWorld(true);
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(0, 7, 0);
    camera.updateMatrixWorld(true);
    const renderer = {} as THREE.WebGLRenderer;
    const scene = new THREE.Scene();
    for (const mesh of objects) {
      mesh.onBeforeRender(
        renderer,
        scene,
        camera,
        mesh.geometry,
        mesh.material as THREE.Material,
        null as unknown as THREE.Group,
      );
    }
    expect(find(objects, "crown", "near")[0]!.count).toBe(1);
    expect(find(objects, "crown", "far")[0]!.count).toBe(0);
  });

  it("colours each crown from its placement and leaves the trunks one colour", () => {
    const objects = trunkTreeObjects([placement(0, 0, "broadleaved")]);
    for (const mesh of objects) repackTreeLod(mesh, { x: 0, y: 0, z: 0 });
    const crown = find(objects, "crown", "near")[0]!;
    const got = new THREE.Color();
    crown.getColorAt(0, got);
    const expected = new THREE.Color().setHex(0x447744, THREE.SRGBColorSpace);
    expect(got.g).toBeCloseTo(expected.g, 5);
    const trunk = find(objects, "trunk", "near")[0]!;
    expect(trunk.instanceColor).toBeNull();
    expect((trunk.material as THREE.MeshStandardMaterial).vertexColors).toBe(
      false,
    );
  });
});
