import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  PART_COVERAGE_TO_HIDE_OUTLINE,
  partCoverage,
  type PlanarPolygon,
} from "./part-coverage.js";

/**
 * Why these tests matter: `buildings.ts` hides a building outline only when
 * its parts cover {@link PART_COVERAGE_TO_HIDE_OUTLINE} of it, so this number
 * decides whether half a building disappears (bug 5 of the 2026-11-07 geometry
 * findings). The share must be right for the shapes the corpus has (a part per
 * wing, a courtyard, two outers) and must not depend on the frame.
 */

function rect(w: number, s: number, e: number, n: number): PlanarPolygon {
  return [
    [
      { x: w, y: s },
      { x: e, y: s },
      { x: e, y: n },
      { x: w, y: n },
    ],
  ];
}

// The grid is 32 cells a side, so a share is exact only to about one
// cell column (1/32 = 3 %); `toBeCloseTo(x, 1)` asks for 5 %.
describe("partCoverage", () => {
  it("is the covered share of the outline", () => {
    const outline = [rect(0, 0, 10, 10)];
    expect(partCoverage(outline, [[rect(0, 0, 3, 10)]])).toBeCloseTo(0.3, 1);
    expect(
      partCoverage(outline, [[rect(0, 0, 5, 10)], [rect(5, 0, 10, 10)]]),
    ).toBe(1);
    expect(partCoverage(outline, [])).toBe(0);
  });

  it("counts overlapping parts once and ignores what lies outside the outline", () => {
    const outline = [rect(0, 0, 10, 10)];
    const share = partCoverage(outline, [
      [rect(0, 0, 5, 10)],
      [rect(-20, 0, 5, 10)],
    ]);
    expect(share).toBeCloseTo(0.5, 2);
  });

  it("leaves a courtyard out of the outline and a part's hole out of the part", () => {
    // The outline has a 4x4 courtyard; a part over the whole ring with the same
    // hole covers all of what is there to cover.
    const hole = [
      { x: 3, y: 3 },
      { x: 7, y: 3 },
      { x: 7, y: 7 },
      { x: 3, y: 7 },
    ];
    const ring = rect(0, 0, 10, 10)[0] ?? [];
    expect(partCoverage([[ring, hole]], [[[ring, hole]]])).toBe(1);
    // A part with a hole where the outline has none leaves 16 % uncovered.
    expect(partCoverage([[ring]], [[[ring, hole]]])).toBeCloseTo(0.84, 1);
  });

  it("samples every outer of a multipolygon outline", () => {
    const outline = [rect(0, 0, 10, 10), rect(20, 0, 30, 10)];
    expect(partCoverage(outline, [[rect(0, 0, 10, 10)]])).toBeCloseTo(0.5, 2);
  });

  it("calls a degenerate outline fully covered, so it stays hidden as before", () => {
    expect(partCoverage([rect(0, 0, 0, 10)], [])).toBe(1);
    expect(partCoverage([], [])).toBe(1);
  });

  it("does not depend on the axis scale, so ENU and lat/lng agree", () => {
    // Property: scaling x (the cos(lat) factor between lat/lng and metres) and
    // shifting the whole picture leaves the share unchanged.
    fc.assert(
      fc.property(
        fc.double({ min: 0.1, max: 0.9, noNaN: true }),
        fc.double({ min: 0.2, max: 5, noNaN: true }),
        fc.double({ min: -100, max: 100, noNaN: true }),
        (cut, scale, shift) => {
          const at = (p: PlanarPolygon): PlanarPolygon =>
            p.map((r) =>
              r.map((q) => ({ x: q.x * scale + shift, y: q.y - shift })),
            );
          const outline = [rect(0, 0, 10, 10)];
          const parts = [[rect(0, 0, cut * 10, 10)]];
          const plain = partCoverage(outline, parts);
          const moved = partCoverage(
            outline.map(at),
            parts.map((p) => p.map(at)),
          );
          expect(moved).toBeCloseTo(plain, 6);
          expect(Math.abs(plain - cut)).toBeLessThan(1 / 32 + 1e-9);
        },
      ),
    );
  });

  it("PIN: the threshold is the owner's 90 %", () => {
    expect(PART_COVERAGE_TO_HIDE_OUTLINE).toBe(0.9);
  });
});
