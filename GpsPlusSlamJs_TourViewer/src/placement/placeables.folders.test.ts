/**
 * Why these tests matter: a plain folder chosen in the tree is moved,
 * turned and scaled by the same gizmo as a block, so it must read as a
 * placeable like one: its pivot at its origin through its holders, its
 * dots its scale, and the blocks that follow it. Its scale must reach
 * every block it holds (the renderer draws them that much larger) and
 * the folders inside it, or a scaled group would draw at its old size.
 */
import type { TourStation } from "gps-plus-slam-app-framework/ar/tour-manifest";
import { itemGeoPose } from "gps-plus-slam-app-framework/ar/tour-station-pose";
import { describe, expect, it } from "vitest";

import "../test-support/tour-of.js";
import { placeableOf } from "./placeables.js";

const UP_90: [number, number, number, number] = [
  0,
  Math.SQRT1_2,
  0,
  Math.SQRT1_2,
];

function pin(id: string, position: [number, number, number]) {
  return {
    id,
    kind: "shortText",
    view: "pin",
    caption: id,
    pose: { position, rotation: [0, 0, 0, 1] },
  };
}

const STATION = {
  id: "well",
  geo: { lat: 48.52, lon: 9.05, alt: 400, rotation: [0, 0, 0, 1] },
  foundRadiusM: 25,
  children: [
    pin("top", [1, 0, 0]),
    {
      id: "outer",
      kind: "folder",
      pose: { position: [10, 0, 0], rotation: UP_90 },
      scale: 2,
      children: [
        pin("a", [1, 0, 0]),
        {
          id: "inner",
          kind: "folder",
          pose: { position: [0, 0, 3], rotation: [0, 0, 0, 1] },
          scale: 3,
          children: [pin("b", [1, 0, 0])],
        },
      ],
    },
    { id: "bare", kind: "folder", children: [] },
  ],
} as unknown as TourStation;
const TOUR = { stations: [STATION] };

describe("a plain folder as a placeable", () => {
  it("stands at its origin, its dots its scale, its blocks its members", () => {
    const outer = placeableOf(TOUR, "folder:outer");
    expect(outer).toMatchObject({
      ref: { kind: "folder", id: "outer" },
      selection: "folder:outer",
      stationId: "well",
      folderPath: [],
      local: { position: [10, 0, 0], rotation: UP_90 },
      inStation: { position: [10, 0, 0], rotation: UP_90 },
      inheritedScale: 1,
      turns: true,
      lifts: true,
      locked: false,
      members: ["a", "b"],
    });
    expect(outer?.extent).toMatchObject({
      kind: "factor",
      field: "scale",
      value: 2,
      min: 0.1,
      max: 10,
    });
    expect(outer?.geo).toEqual(
      itemGeoPose({ position: [10, 0, 0], rotation: UP_90 }, STATION.geo),
    );
  });

  // Why: a nested folder's pivot is composed through its holder, scale
  // included: [0, 0, 3] scaled by 2, turned 90 degrees about up (east to
  // north), then 10 north: [16, 0, 0].
  it("composes a nested folder's pivot and its holders' scale", () => {
    const inner = placeableOf(TOUR, "folder:inner");
    expect(inner?.folderPath).toEqual(["outer"]);
    expect(inner?.inheritedScale).toBe(2);
    expect(inner?.extent?.value).toBe(3);
    expect(inner?.members).toEqual(["b"]);
    const [n, u, e] = inner?.inStation?.position ?? [NaN, NaN, NaN];
    expect(n).toBeCloseTo(16, 12);
    expect(u).toBeCloseTo(0, 12);
    expect(e).toBeCloseTo(0, 12);
  });

  it("gives a folder with no pose or scale its holder's frame and a scale of 1", () => {
    const bare = placeableOf(TOUR, "folder:bare");
    expect(bare?.local).toEqual({
      position: [0, 0, 0],
      rotation: [0, 0, 0, 1],
    });
    expect(bare?.extent?.value).toBe(1);
    expect(bare?.members).toEqual([]);
  });

  it("gives each block the product of its folders' scales", () => {
    expect(placeableOf(TOUR, "top")?.inheritedScale).toBe(1);
    expect(placeableOf(TOUR, "a")?.inheritedScale).toBe(2);
    expect(placeableOf(TOUR, "b")?.inheritedScale).toBe(6);
  });

  it("is none for a folder the tour lacks", () => {
    expect(placeableOf(TOUR, "folder:nothing")).toBeNull();
    expect(placeableOf(TOUR, "folder:")).toBeNull();
  });
});
