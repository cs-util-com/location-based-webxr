/**
 * Why these tests matter: a saved chain comes from a file the tour only
 * checked for inertness, so a malformed `extras.lod` must leave the model
 * drawn as it is rather than draw out of range; and the level a frame
 * draws must follow the screen error (finer when near or wide, coarser
 * when far), or a near model shows its coarse levels.
 */
import { describe, expect, it } from "vitest";

import {
  LOD_PIXEL_BUDGET,
  levelsFit,
  lodOf,
  pickLevel,
  pixelsPerUnit,
} from "./glb-lod.js";

const LEVELS = [
  { start: 0, count: 300, error: 0.002 },
  { start: 300, count: 150, error: 0.004 },
  { start: 450, count: 75, error: 0.01 },
];

/** three.js's perspective projection for a vertical field of view. */
function perspective(fovDegrees: number): number[] {
  const f = 1 / Math.tan((fovDegrees * Math.PI) / 360);
  const m = new Array<number>(16).fill(0);
  m[0] = f;
  m[5] = f;
  m[10] = -1;
  m[11] = -1;
  m[14] = -0.2;
  return m;
}

describe("lodOf", () => {
  it("reads well-formed levels", () => {
    expect(lodOf({ indices: 7, levels: LEVELS })).toEqual({
      indices: 7,
      levels: LEVELS,
    });
  });

  it.each([
    ["nothing", undefined],
    ["a number", 3],
    ["no levels", { indices: 1, levels: [] }],
    ["a bad accessor", { indices: -1, levels: LEVELS }],
    [
      "a fractional start",
      { indices: 1, levels: [{ ...LEVELS[0], start: 0.5 }] },
    ],
    [
      "a count that is no triangle list",
      { indices: 1, levels: [{ ...LEVELS[0], count: 4 }] },
    ],
    ["an empty level", { indices: 1, levels: [{ ...LEVELS[0], count: 0 }] }],
    [
      "a NaN error",
      { indices: 1, levels: [{ ...LEVELS[0], error: Number.NaN }] },
    ],
    ["a negative error", { indices: 1, levels: [{ ...LEVELS[0], error: -1 }] }],
    ["a level that is no object", { indices: 1, levels: [null] }],
  ])("refuses %s", (_name, value) => {
    expect(lodOf(value)).toBeNull();
  });
});

describe("levelsFit", () => {
  it("holds every level inside the index list, and only then", () => {
    expect(levelsFit(LEVELS, 525)).toBe(true);
    expect(levelsFit(LEVELS, 524)).toBe(false);
  });
});

describe("pixelsPerUnit", () => {
  it("halves when the depth doubles under a perspective camera", () => {
    const p = perspective(60);
    const near = pixelsPerUnit(p, 1000, 2);
    expect(near).toBeCloseTo(((1 / Math.tan(Math.PI / 6)) * 500) / 2, 9);
    expect(pixelsPerUnit(p, 1000, 4)).toBeCloseTo(near / 2, 9);
  });

  it("is infinite behind or at the camera, so the finest level draws", () => {
    expect(pixelsPerUnit(perspective(60), 1000, 0)).toBe(Infinity);
    expect(pixelsPerUnit(perspective(60), 1000, -1)).toBe(Infinity);
  });

  it("ignores depth under an orthographic camera", () => {
    const m = new Array<number>(16).fill(0);
    m[0] = 0.1;
    m[5] = 0.1;
    m[10] = -0.01;
    m[15] = 1;
    expect(pixelsPerUnit(m, 1000, 5)).toBeCloseTo(50, 9);
    expect(pixelsPerUnit(m, 1000, 500)).toBeCloseTo(50, 9);
  });
});

describe("pickLevel", () => {
  it("draws the finest level up close and coarser levels further away", () => {
    // A 1 m model in a 1000 px tall view at 60 degrees.
    const at = (depth: number) =>
      pickLevel(LEVELS, pixelsPerUnit(perspective(60), 1000, depth));
    expect(at(1)).toBe(0);
    expect(at(4)).toBe(1);
    expect(at(10)).toBe(2);
    expect(at(1000)).toBe(2);
  });

  it("keeps the finest level when the screen size is no finite positive number", () => {
    for (const k of [0, -1, Number.NaN, Infinity]) {
      expect(pickLevel(LEVELS, k)).toBe(0);
    }
  });

  it("takes the coarsest level within the budget even when errors are out of order", () => {
    const shuffled = [LEVELS[0]!, { ...LEVELS[1]!, error: 0.05 }, LEVELS[2]!];
    expect(pickLevel(shuffled, 100)).toBe(2);
  });

  it("follows the pixel budget", () => {
    expect(LOD_PIXEL_BUDGET).toBe(1);
    expect(pickLevel(LEVELS, 200, 0.5)).toBe(0);
    expect(pickLevel(LEVELS, 200, 1)).toBe(1);
    expect(pickLevel(LEVELS, 200, 2)).toBe(2);
  });
});
