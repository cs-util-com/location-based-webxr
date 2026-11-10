import { describe, expect, it } from "vitest";
import { Group, Mesh, Object3D } from "three";

import { drawAtExtent, markPlaceScale } from "./place-scale.js";

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
