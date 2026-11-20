import { describe, expect, it } from "vitest";
import type {
  Matrix4,
  Quaternion,
  Vector3,
} from "gps-plus-slam-app-framework/core";

import { SYNTHETIC_PROJECTION } from "../test-support/synthetic-recording.js";
import {
  createOwnership,
  sees,
  shellCrop,
  type OwnershipCamera,
} from "./splat-ownership.js";

/** Looking along -z (WebXR's forward) with no rotation. */
const FORWARD: Quaternion = [0, 0, 0, 1];
/** Turned 180 degrees about y: looking along +z. */
const BACKWARD: Quaternion = [0, 1, 0, 0];

function camera(
  x: number,
  window: number,
  rotation: Quaternion = FORWARD,
): OwnershipCamera {
  return { position: [x, 0, 0], rotation, window };
}

const P: Matrix4 = SYNTHETIC_PROJECTION;

describe("sees", () => {
  it("sees a point straight ahead and not one behind or far to the side", () => {
    // Why: the frustum test is what decides which cameras can claim a
    // splat; behind the camera (w <= 0) must never count.
    const cam = camera(0, 0);
    expect(sees(cam, P, [0, 0, -5])).toBe(true);
    expect(sees(cam, P, [0, 0, 5])).toBe(false);
    expect(sees(cam, P, [50, 0, -5])).toBe(false);
    expect(sees(camera(0, 0, BACKWARD), P, [0, 0, 5])).toBe(true);
  });

  it("ignores the near and far planes", () => {
    // Why: a splat closer than the near plane or past the far plane is
    // still in the camera's view cone; the clip planes are a renderer's.
    const cam = camera(0, 0);
    expect(sees(cam, P, [0, 0, -0.01])).toBe(true);
    expect(sees(cam, P, [0, 0, -5000])).toBe(true);
  });
});

describe("createOwnership", () => {
  const windows = [{ segment: 0 }, { segment: 0 }, { segment: 0 }];

  it("gives a point to the nearest camera that sees it within range", () => {
    // Why: the nearest view has the finest detail of the spot.
    const own = createOwnership(
      [camera(0, 0), camera(10, 1), camera(20, 2)],
      windows,
      P,
      40,
    );
    expect(own.ownerOf([11, 0, -3])).toBe(1);
    expect(own.ownerOf([1, 0, -3])).toBe(0);
  });

  it("gives a point no camera sees to no window", () => {
    const own = createOwnership([camera(0, 0)], [{ segment: 0 }], P, 40);
    expect(own.ownerOf([0, 0, 5])).toBe(-1);
  });

  it("gives a point seen only from beyond the range to the nearest camera that sees it", () => {
    // Why: a far view is still the only view; dropping it would leave a
    // hole where the walk saw something.
    const own = createOwnership(
      [camera(0, 0), camera(10, 1, BACKWARD)],
      [{ segment: 0 }, { segment: 0 }],
      P,
      5,
    );
    expect(own.ownerOf([0, 0, -50])).toBe(0);
  });

  it("gives a revisited spot to the earliest window, whichever camera is nearer", () => {
    // Why: windows 0 and 2 are not neighbours (a walk that came back); if
    // each kept the splats its nearer camera claims, the spot would hold
    // two interleaved copies of itself.
    const own = createOwnership(
      [camera(0, 0), camera(500, 1), camera(1, 2)],
      windows,
      P,
      40,
    );
    expect(own.ownerOf([1, 0, -2])).toBe(0);
    expect(own.ownerOf([0.2, 0, -2])).toBe(0);
  });

  it("splits a seam between neighbouring windows by the nearest camera", () => {
    // Why: neighbours share the overlap on purpose; the nearest view wins
    // there, with no first-come rule.
    const own = createOwnership(
      [camera(0, 0), camera(4, 1)],
      [{ segment: 0 }, { segment: 0 }],
      P,
      40,
    );
    // Both cameras see these two points.
    expect(own.ownerOf([2.5, 0, -4])).toBe(1);
    expect(own.ownerOf([1.5, 0, -4])).toBe(0);
  });

  it("treats windows of different segments as never neighbours", () => {
    const own = createOwnership(
      [camera(0, 0), camera(1, 1)],
      [{ segment: 0 }, { segment: 1 }],
      P,
      40,
    );
    expect(own.ownerOf([1, 0, -2])).toBe(0);
  });

  it("rejects a camera of an unknown window and a bad range", () => {
    expect(() => createOwnership([camera(0, 3)], windows, P, 40)).toThrow(
      RangeError,
    );
    expect(() => createOwnership([camera(0, 0)], windows, P, 0)).toThrow(
      RangeError,
    );
  });
});

describe("shellCrop", () => {
  it("keeps a point within the keep distance of one of the window's cameras", () => {
    // Why: past the keep distance lie the background shell's splats,
    // which every window grows on its own and the merge must not stack.
    const keep = shellCrop(
      [
        [0, 0, -5],
        [0, 0, -50],
        [30, 0, 0],
      ] as Vector3[],
      [
        [0, 0, 0],
        [28, 0, 0],
      ] as Vector3[],
      0.8 * 25,
    );
    expect(keep).toEqual([true, false, true]);
  });

  it("rejects a non-positive keep distance", () => {
    expect(() => shellCrop([], [], 0)).toThrow(RangeError);
  });
});
