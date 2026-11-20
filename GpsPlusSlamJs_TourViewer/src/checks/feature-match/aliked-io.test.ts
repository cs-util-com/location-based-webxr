import { describe, expect, it } from "vitest";

import { makeFrame } from "./bench-image";
import {
  chwInput,
  floatData,
  pairsFromMatches,
  pickName,
  stackPair,
} from "./aliked-io";

// Why these tests matter: the ONNX models take channels-first RGB and a
// stacked pair, and give matches as an index list with -1 for "none"; a
// swapped channel order or a -1 read as a match would change the counts
// without any error.
describe("chwInput", () => {
  it("lays out RGB channels first, scaled to [0, 1]", () => {
    const f = makeFrame(
      2,
      1,
      new Uint8ClampedArray([255, 0, 51, 255, 0, 102, 255, 255]),
    );
    const got = Array.from(chwInput(f));
    const want = [1, 0, 0, 0.4, 0.2, 1];
    expect(got).toHaveLength(want.length);
    want.forEach((v, i) => expect(got[i]).toBeCloseTo(v, 6));
  });
});

describe("pickName", () => {
  it("prefers the named output and falls back to the position", () => {
    expect(pickName(["a", "descriptors"], "descriptors", 0)).toBe(
      "descriptors",
    );
    expect(pickName(["x", "y", "z"], "descriptors", 2)).toBe("z");
    expect(() => pickName(["x"], "descriptors", 2)).toThrow(/no "descriptors"/);
  });
});

describe("stackPair", () => {
  it("puts B after A and refuses halves of different size", () => {
    expect(
      Array.from(stackPair(new Float32Array([1, 2]), new Float32Array([3, 4]))),
    ).toEqual([1, 2, 3, 4]);
    expect(() => stackPair(new Float32Array(1), new Float32Array(2))).toThrow(
      RangeError,
    );
  });
});

describe("pairsFromMatches", () => {
  it("keeps only real matches, from int32 or int64 output", () => {
    expect(
      Array.from(pairsFromMatches(new Int32Array([2, -1, 0, 9]), 3)),
    ).toEqual([0, 2, 2, 0]);
    expect(
      Array.from(pairsFromMatches(new BigInt64Array([-1n, 1n]), 2)),
    ).toEqual([1, 1]);
  });
});

describe("floatData", () => {
  it("passes float32 data and names anything else", () => {
    const f = new Float32Array(1);
    expect(floatData(f, "keypoints")).toBe(f);
    expect(() => floatData(new Int32Array(1), "keypoints")).toThrow(
      "keypoints: expected float32 data",
    );
  });
});
