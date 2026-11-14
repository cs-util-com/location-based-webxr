/**
 * Why these tests matter: the look is drawn at the prototype's reference
 * width and scaled, so its size must follow the creator's width exactly
 * (the editor's size preview and the placement contract read it); a
 * cutout turns toward the visitor but never so far that it shows its
 * edge; and a porthole crops the clip to its centred square whatever its
 * shape.
 */
import { Box3, type Object3D, Vector3 } from "three";
import { describe, expect, it } from "vitest";

import {
  CUTOUT_MAX_TURN,
  centredSquare,
  videoLook,
  type LookState,
  type VideoWorldView,
} from "./video-look.js";

function look(view: VideoWorldView, widthM: number) {
  return videoLook({
    view,
    widthM,
    aspect: 0.5625,
    stacked: false,
    liftM: 0,
    edit: false,
    canvasTexture: () => {
      throw new Error("no canvas in node");
    },
  });
}

const STILL: LookState = {
  clip: null,
  poster: null,
  started: false,
  playing: false,
  progress: 0,
  time: "0:00 / 0:00",
  sound: false,
  seconds: 0,
  viewer: null,
};

function size(o: Object3D): Vector3 {
  o.updateMatrixWorld(true);
  return new Box3().setFromObject(o).getSize(new Vector3());
}

/** The largest turn about the vertical among the look's parts. */
function turn(o: Object3D): number {
  let most = 0;
  o.traverse((c) => {
    if (Math.abs(c.rotation.y) > Math.abs(most)) most = c.rotation.y;
  });
  return most;
}

describe("a free video's look", () => {
  it("is exactly twice as large at twice the width, in every view", () => {
    for (const view of ["screen", "cutout", "porthole"] as const) {
      const one = size(look(view, 1.6).object);
      const two = size(look(view, 3.2).object);
      expect(two.x / one.x, view).toBeCloseTo(2, 5);
      expect(two.y / one.y, view).toBeCloseTo(2, 5);
    }
  });

  it("turns a cutout toward the viewer, at most 30 degrees", () => {
    const cutout = look("cutout", 1.6);
    cutout.show({ ...STILL, viewer: [0, 1.5, 6], seconds: 0 });
    expect(Math.abs(turn(cutout.object))).toBeLessThan(1e-6);
    // Far to the side: it would face him only at 90 degrees.
    for (let s = 1; s < 30; s++) {
      cutout.show({ ...STILL, viewer: [100, 1.5, 0.5], seconds: s });
    }
    expect(turn(cutout.object)).toBeCloseTo(CUTOUT_MAX_TURN, 3);
  });

  it("crops a clip to its centred square, whatever its shape", () => {
    expect(centredSquare(1)).toEqual([0, 0, 1, 1]);
    expect(centredSquare(0.5625)).toEqual([(1 - 0.5625) / 2, 0, 0.5625, 1]);
    expect(centredSquare(2)).toEqual([0, 0.25, 1, 0.5]);
    expect(centredSquare(Number.NaN)).toEqual([0, 0, 1, 1]);
  });
});
