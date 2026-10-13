/**
 * The selected object's mark in the AR scene (polish round M3, B2: the
 * owner wants to tap an object and SEE it selected; H1's accent ring).
 *
 * Why these tests matter: the mark hangs off a preview's group, and the
 * creator's previews are redrawn (a move, a sync) - so showing the mark
 * must be idempotent for the same group, follow a new group, and leave no
 * mesh behind when the selection goes or the session ends.
 */
import { describe, expect, it } from "vitest";
import { Group, Object3D, Raycaster, Vector3, type Mesh } from "three";

import { createSelectionMark, SELECTION_MARK_NAME } from "./selection-mark.js";

/** A preview's group: one object at its anchor, as `renderTourObjects`. */
function preview(x: number, y: number, z: number): Group {
  const group = new Group();
  const object = new Object3D();
  object.position.set(x, y, z);
  group.add(object);
  return group;
}

const marks = (root: Object3D) =>
  root.children.filter((c) => c.name === SELECTION_MARK_NAME);

describe("createSelectionMark", () => {
  it("rings the object at its anchor, flat, once per group", () => {
    const mark = createSelectionMark();
    const root = preview(1, 0.2, -3);
    mark.show(root);
    mark.show(root);
    expect(marks(root)).toHaveLength(1);
    const ring = marks(root)[0] as Mesh;
    expect(ring.position.toArray()).toEqual([1, 0.2, -3]);
    // Lying on the surface the pin stands on (H1's ground halo).
    expect(ring.rotation.x).toBeCloseTo(-Math.PI / 2);
  });

  it("moves to another group, and goes with the selection", () => {
    const mark = createSelectionMark();
    const a = preview(0, 0, 0);
    const b = preview(2, 0, 0);
    mark.show(a);
    mark.show(b);
    expect(marks(a)).toHaveLength(0);
    expect(marks(b)).toHaveLength(1);
    mark.show(null);
    expect(marks(b)).toHaveLength(0);
  });

  it("follows a redrawn group of the same object (a move re-renders it)", () => {
    const mark = createSelectionMark();
    const before = preview(0, 0, 0);
    mark.show(before);
    const after = preview(4, 0, 2);
    mark.show(after);
    expect(marks(before)).toHaveLength(0);
    expect((marks(after)[0] as Mesh).position.toArray()).toEqual([4, 0, 2]);
  });

  // Why (M3 review #7): a photo's anchor is where it was taken, so a flat
  // ring there cuts the photo plane, and with the depth test on the plane
  // hid half of it; and the ring is part of the preview's group, so a tap
  // near the base would pick it and re-select instead of letting go.
  it("draws over the object, and is never what a tap picks", () => {
    const mark = createSelectionMark();
    const root = preview(0, 1.4, -2);
    mark.show(root);
    const ring = marks(root)[0] as Mesh;
    const material = ring.material as { depthTest: boolean };
    expect(material.depthTest).toBe(false);
    const hits: unknown[] = [];
    ring.raycast(
      new Raycaster(new Vector3(0, 5, -2), new Vector3(0, -1, 0)),
      hits as never,
    );
    expect(hits).toEqual([]);
  });

  it("is large enough to read at a distance (about H1's halo)", () => {
    const mark = createSelectionMark();
    const root = preview(0, 0, 0);
    mark.show(root);
    const ring = marks(root)[0] as Mesh;
    ring.geometry.computeBoundingSphere();
    expect(ring.geometry.boundingSphere!.radius).toBeGreaterThanOrEqual(0.38);
  });

  it("frees its mesh on dispose", () => {
    const mark = createSelectionMark();
    const root = preview(0, 0, 0);
    mark.show(root);
    const ring = marks(root)[0] as Mesh;
    let disposed = 0;
    ring.geometry.addEventListener("dispose", () => (disposed += 1));
    mark.dispose();
    expect(marks(root)).toHaveLength(0);
    expect(disposed).toBe(1);
  });

  it("marks nothing for a group without an object (a photo that failed)", () => {
    const mark = createSelectionMark();
    const empty = new Group();
    mark.show(empty);
    expect(marks(empty)).toHaveLength(0);
  });
});
