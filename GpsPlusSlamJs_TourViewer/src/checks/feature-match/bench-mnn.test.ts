import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { mutualNearestBytes, mutualNearestFloat } from "./bench-mnn";

function pairsOf(flat: Int32Array): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < flat.length; i += 2) {
    out.push([flat[i]!, flat[i + 1]!]);
  }
  return out;
}

// Why these tests matter: the match count and the matching time of the
// descriptor methods come from this one function; a pair that is only a
// one-way nearest neighbour, or a similarity floor that is not applied,
// would inflate the count the tester compares across methods.
describe("mutualNearestFloat", () => {
  it("keeps only pairs that are each other's nearest", () => {
    // A0 ~ B1, A1 ~ B0; A2 is nearest to B0 too, but B0 prefers A1.
    const a = new Float32Array([1, 0, 0, 1, 0.8, 0.6]);
    const b = new Float32Array([0, 1, 1, 0]);
    expect(pairsOf(mutualNearestFloat(a, 3, b, 2, 2))).toEqual([
      [0, 1],
      [1, 0],
    ]);
  });

  it("drops pairs below the similarity floor", () => {
    const a = new Float32Array([1, 0]);
    const b = new Float32Array([0.6, 0.8]);
    expect(mutualNearestFloat(a, 1, b, 1, 2, 0.82).length).toBe(0);
    expect(mutualNearestFloat(a, 1, b, 1, 2, 0.5).length).toBe(2);
  });

  it("refuses descriptor buffers shorter than the counts say", () => {
    expect(() =>
      mutualNearestFloat(new Float32Array(3), 2, new Float32Array(4), 2, 2),
    ).toThrow(RangeError);
  });

  it("is symmetric: swapping A and B swaps every pair (property)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 0, max: 1000 }),
        (nA, nB, seed) => {
          const dim = 4;
          let s = seed + 1;
          const next = () =>
            ((s = (s * 16807) % 2147483647) / 2147483647) * 2 - 1;
          const a = Float32Array.from({ length: nA * dim }, next);
          const b = Float32Array.from({ length: nB * dim }, next);
          const ab = pairsOf(mutualNearestFloat(a, nA, b, nB, dim));
          const ba = pairsOf(mutualNearestFloat(b, nB, a, nA, dim)).map(
            ([x, y]) => [y, x] as [number, number],
          );
          ba.sort((p, q) => p[0] - q[0]);
          expect(ab).toEqual(ba);
          expect(new Set(ab.map((p) => p[1])).size).toBe(ab.length);
        },
      ),
    );
  });
});

describe("mutualNearestBytes", () => {
  it("matches byte descriptors by squared distance", () => {
    const a = new Uint8Array([0, 0, 200, 200]);
    const b = new Uint8Array([190, 210, 10, 0]);
    expect(pairsOf(mutualNearestBytes(a, 2, b, 2, 2))).toEqual([
      [0, 1],
      [1, 0],
    ]);
  });

  it("returns no pairs when one side is empty", () => {
    expect(
      mutualNearestBytes(new Uint8Array(0), 0, new Uint8Array(2), 1, 2).length,
    ).toBe(0);
  });
});
