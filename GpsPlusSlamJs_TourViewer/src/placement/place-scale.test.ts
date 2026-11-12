import { describe, expect, it } from "vitest";
import { Group, Mesh, Object3D } from "three";

import {
  drawAtExtent,
  drawInherited,
  inheritedScaleOf,
  markPlaceScale,
} from "./place-scale.js";

// Why these tests matter: a drag's preview draws a model at its dragged
// size and a picture at its dragged width through this one mark; a wrong
// ratio, a lost aspect or a scale that does not come back would show the
// creator a drawing the tour does not hold.
describe("place scale", () => {
  it("draws a plane at a dragged width, keeping its aspect, and back", () => {
    const plane = new Mesh();
    plane.scale.set(2, 1.5, 1);
    markPlaceScale(plane, 2);
    drawAtExtent(plane, 4);
    expect(plane.scale.toArray()).toEqual([4, 3, 2]);
    drawAtExtent(plane, null);
    expect(plane.scale.toArray()).toEqual([2, 1.5, 1]);
  });

  it("finds the marked object under its root", () => {
    const root = new Group();
    const part = new Group();
    const model = new Object3D();
    model.scale.setScalar(0.5);
    markPlaceScale(model, 3);
    part.add(model);
    root.add(part);
    drawAtExtent(root, 6);
    expect(model.scale.toArray()).toEqual([1, 1, 1]);
    expect(part.scale.toArray()).toEqual([1, 1, 1]);
  });

  it("leaves a root with no mark, or a broken one, as it is", () => {
    const bare = new Object3D();
    bare.scale.set(2, 2, 2);
    drawAtExtent(bare, 5);
    expect(bare.scale.toArray()).toEqual([2, 2, 2]);
    const broken = new Object3D();
    broken.userData["placeScale"] = [1, "x", 1];
    broken.userData["placeExtent"] = 1;
    drawAtExtent(broken, 5);
    expect(broken.scale.toArray()).toEqual([1, 1, 1]);
  });

  it("marks nothing for an extent that is no positive number, and draws a bad value as drawn", () => {
    for (const extent of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const o = new Object3D();
      markPlaceScale(o, extent);
      expect(o.userData["placeScale"]).toBeUndefined();
    }
    const o = new Object3D();
    o.scale.set(3, 3, 3);
    markPlaceScale(o, 1);
    for (const value of [0, -2, Number.NaN]) {
      drawAtExtent(o, value);
      expect(o.scale.toArray()).toEqual([3, 3, 3]);
    }
  });
});

// Why these tests matter: a scaled folder draws every block in it larger
// through this one call, and a drag of the folder's scale calls it again
// each frame; a scale that piled up instead of being set, or a dragged
// width that forgot the folder's scale, would draw a tour the file does
// not hold.
describe("inherited scale", () => {
  it("sets the folders' scale rather than adding to it, and clears it at 1", () => {
    const root = new Group();
    root.scale.set(2, 1, 1);
    expect(inheritedScaleOf(root)).toBe(1);
    drawInherited(root, 2);
    expect(root.scale.toArray()).toEqual([4, 2, 2]);
    expect(inheritedScaleOf(root)).toBe(2);
    drawInherited(root, 2);
    expect(root.scale.toArray()).toEqual([4, 2, 2]);
    drawInherited(root, 4);
    expect(root.scale.toArray()).toEqual([8, 4, 4]);
    drawInherited(root, 1);
    expect(root.scale.toArray()).toEqual([2, 1, 1]);
    expect(root.userData["placeInherited"]).toBeUndefined();
  });

  it("carries a root's own mark, so a dragged width keeps the folders' scale", () => {
    const plane = new Mesh();
    plane.scale.set(2, 1.5, 1);
    markPlaceScale(plane, 2);
    drawInherited(plane, 2);
    expect(plane.scale.toArray()).toEqual([4, 3, 2]);
    drawAtExtent(plane, 4);
    expect(plane.scale.toArray()).toEqual([8, 6, 4]);
    drawAtExtent(plane, null);
    expect(plane.scale.toArray()).toEqual([4, 3, 2]);
    drawInherited(plane, 1);
    drawAtExtent(plane, null);
    expect(plane.scale.toArray()).toEqual([2, 1.5, 1]);
  });

  it("leaves a child's mark alone: the root's scale carries it", () => {
    const root = new Group();
    const model = new Object3D();
    model.scale.setScalar(0.5);
    markPlaceScale(model, 3);
    root.add(model);
    drawInherited(root, 2);
    expect(root.scale.toArray()).toEqual([2, 2, 2]);
    drawAtExtent(root, 6);
    expect(model.scale.toArray()).toEqual([1, 1, 1]);
    expect(root.scale.toArray()).toEqual([2, 2, 2]);
  });

  it("draws a scale that is no positive number, or a broken one stored, at 1", () => {
    for (const bad of [0, -2, Number.NaN, Number.POSITIVE_INFINITY]) {
      const root = new Object3D();
      drawInherited(root, 3);
      drawInherited(root, bad);
      expect(root.scale.toArray()).toEqual([1, 1, 1]);
      expect(inheritedScaleOf(root)).toBe(1);
    }
    const broken = new Object3D();
    broken.userData["placeInherited"] = "x";
    expect(inheritedScaleOf(broken)).toBe(1);
  });
});
