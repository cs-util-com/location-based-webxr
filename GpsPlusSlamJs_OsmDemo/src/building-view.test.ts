/**
 * The one part of `building-view.ts` that is arithmetic rather than three.js.
 *
 * WHY THIS FILE EXISTS AND WHY IT IS THIS SMALL. `BuildingView` needs a
 * `WebGLRenderer`, so the class itself cannot be constructed under vitest — its
 * behaviour is covered by the e2e suite instead. But the tree loop is not
 * renderer work: it converts an ENU placement into a scene position, and it got
 * that conversion wrong in exactly the way `mesh-data.ts` warns about. The
 * package hands out `TreePlacement.position` in ENU (`+y` north) while the
 * buffers this scene is built from use the render frame (`-z` north), so a
 * consumer packing its own instances has to apply the reflection itself.
 *
 * Pulling those three numbers out of the loop is what makes the frame provable
 * without a GPU — and the frame is the part that fails silently: trees stay
 * consistent with each OTHER, so a mirrored forest reads as bad data or a
 * compass bug rather than a sign error.
 */

import { describe, expect, it } from "vitest";

import type { TreePlacement } from "gps-plus-slam-osm";

import { treeConePosition } from "./building-view.js";

/** A placement `eastM` east and `northM` north of the origin, in ENU. */
function placement(
  eastM: number,
  northM: number,
  overrides: Partial<TreePlacement> = {},
): TreePlacement {
  return {
    feature: "node/1",
    position: { x: eastM, y: northM },
    groundHeightM: 0,
    heightM: 10,
    crownDiameterM: 6,
    rotationY: 0,
    variant: "unknown",
    ...overrides,
  };
}

describe("treeConePosition", () => {
  it("puts a tree 50 m NORTH at NEGATIVE z, like every other buffer", () => {
    // WHY THIS TEST MATTERS. This is the assertion that ties the scene to the
    // real world. Everything else about a tree — its height, its crown, its
    // rotation — is self-consistent under a mirror, so nothing but this can
    // catch the reflection being skipped. It was skipped: trees rendered 100 m
    // from the buildings they stand next to, on the wrong side of the origin.
    const [, , z] = treeConePosition(placement(0, 50));
    expect(z).toBeCloseTo(-50, 6);
  });

  it("keeps ENU east at POSITIVE x, so only one axis is mirrored", () => {
    // The counterpart: mirroring the wrong axis, or both, also satisfies
    // "north is negative" while rotating the forest 180 degrees.
    const [x] = treeConePosition(placement(30, 0));
    expect(x).toBeCloseTo(30, 6);
  });

  it("stands the cone ON the ground rather than half-buried in it", () => {
    // `ConeGeometry` is centred on its origin, so the centre has to sit half a
    // height above the terrain sample. Using the ground height directly would
    // sink every tree to its crown — which on flat ground still looks like a
    // short tree, and only becomes obviously wrong on a slope.
    const [, y] = treeConePosition(
      placement(0, 0, { groundHeightM: 12, heightM: 8 }),
    );
    expect(y).toBeCloseTo(16, 6);
  });
});
