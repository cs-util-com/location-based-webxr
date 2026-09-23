/**
 * Why these tests matter: the phone run's corner-order verdict ("Cause A":
 * does Android Chrome's BarcodeDetector report corners by IMAGE position or in
 * SYMBOL order?) is read straight off these functions. zxing's corners are
 * symbol-relative (proven in the framework's zxing oracle tests), so if the
 * native corners are too, the permutation is the identity at every roll; if
 * native sorts by image position, the permutation rotates with the roll bin.
 */

import { describe, expect, it } from "vitest";
import {
  cornerPermutation,
  createCornerOrderTally,
  maxCornerDistance,
  rollBin,
} from "./corner-compare.js";

const SQUARE = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
  { x: 0, y: 10 },
] as const;

describe("cornerPermutation", () => {
  it("is the identity when both detectors agree on the order", () => {
    expect(cornerPermutation(SQUARE, SQUARE)).toBe("0123");
  });

  it("names the zxing index nearest to each native corner", () => {
    const shifted = [SQUARE[1], SQUARE[2], SQUARE[3], SQUARE[0]];
    // native[0] = (10,0) is zxing index 1, and so on.
    expect(cornerPermutation(shifted, SQUARE)).toBe("1230");
  });
});

describe("maxCornerDistance", () => {
  it("measures position agreement independently of the order", () => {
    const shifted = [SQUARE[1], SQUARE[2], SQUARE[3], SQUARE[0]];
    expect(maxCornerDistance(shifted, SQUARE)).toBe(0);
    const nudged = [{ x: 3, y: 4 }, SQUARE[1], SQUARE[2], SQUARE[3]];
    expect(maxCornerDistance(nudged, SQUARE)).toBe(5);
  });
});

describe("rollBin", () => {
  it("rounds an in-image rotation to the nearest quarter turn", () => {
    expect(rollBin(0)).toBe(0);
    expect(rollBin(44)).toBe(0);
    expect(rollBin(46)).toBe(90);
    expect(rollBin(-90)).toBe(270);
    expect(rollBin(181)).toBe(180);
    expect(rollBin(359)).toBe(0);
  });
});

describe("createCornerOrderTally", () => {
  it("counts identity and non-identity permutations per roll bin", () => {
    const tally = createCornerOrderTally();
    tally.add(0, "0123");
    tally.add(0, "0123");
    tally.add(90, "1230");
    expect(tally.summary()).toEqual({
      0: { identity: 2, other: 0, permutations: ["0123"] },
      90: { identity: 0, other: 1, permutations: ["1230"] },
    });
  });
});
