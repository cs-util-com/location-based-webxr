/**
 * The exact overlap predicate: ring vs ring, and polygon vs polygon with holes.
 *
 * WHY THIS FILE EXISTS. The spatial index's narrow phase needs "do these two
 * shapes share any area", exactly, and every candidate structure needs it
 * whatever its broad phase turns out to be. `cell-overlap.ts` already contained
 * the ring-vs-ring half — everything below its `boundaryOf` call was already
 * operating on two plain point arrays — so this hoists that out and adds the one
 * genuinely new case: HOLES.
 *
 * THE HOLE CASE IS THE WHOLE POINT, and it is the one a naive composite gets
 * wrong. A shape sitting entirely inside another's hole passes every
 * ring-vs-ring test against the outer ring — a vertex is "inside", the edges do
 * not cross — and shares no area at all. A courtyard, a clearing in a wood, a
 * lake in an island: all real, all common in OSM.
 *
 * WHY NOT JUST TRUST THE THREE WITNESSES. They are complete for SIMPLE
 * polygons: A-inside-B fires witness 2, B-inside-A fires witness 1, and a
 * partial overlap fires witness 3. Holes break that completeness, and nothing
 * about the witnesses says so — which is exactly the kind of silent wrongness
 * this package treats as the worst failure mode.
 */

import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { polygonsOverlap, ringsOverlap } from "./ring-overlap.js";
import type { PlanarPoint } from "./point-in-ring.js";

/** An axis-aligned box, counter-clockwise. */
function box(
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): PlanarPoint[] {
  return [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
  ];
}

describe("ringsOverlap — two simple rings", () => {
  it("is false for rings that share no area", () => {
    expect(ringsOverlap(box(0, 0, 10, 10), box(20, 20, 30, 30))).toBe(false);
  });

  it("is true when they partially overlap", () => {
    // The witness-3 case: neither contains a vertex of the other in the
    // overlapping corner, the edges simply cross.
    expect(ringsOverlap(box(0, 0, 10, 10), box(5, 5, 15, 15))).toBe(true);
  });

  it("is true when one is wholly inside the other, either way round", () => {
    // Witness 1 and witness 2 respectively. Both directions are asserted
    // because a predicate that tests only one is wrong exactly half the time
    // and looks right in any test that happens to pass the bigger shape first.
    expect(ringsOverlap(box(0, 0, 10, 10), box(2, 2, 4, 4))).toBe(true);
    expect(ringsOverlap(box(2, 2, 4, 4), box(0, 0, 10, 10))).toBe(true);
  });

  it("is true for identical rings", () => {
    expect(ringsOverlap(box(0, 0, 10, 10), box(0, 0, 10, 10))).toBe(true);
  });

  it("counts a shared edge as overlapping", () => {
    // `segment-crossing.ts` documents this choice: touching counts, because a
    // path grazing a wall's corner should be refused rather than admitted. OSM
    // is full of shared edges — adjacent buildings, a fence along a boundary —
    // so this is the common case, not an edge case.
    expect(ringsOverlap(box(0, 0, 10, 10), box(10, 0, 20, 10))).toBe(true);
  });

  it("is false for a ring that cannot bound an area", () => {
    // Real Overpass output contains two-node ways and degenerate rings; a
    // library that must survive the planet cannot make one fatal.
    expect(ringsOverlap([], box(0, 0, 10, 10))).toBe(false);
    expect(
      ringsOverlap(
        [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ],
        box(0, 0, 10, 10),
      ),
    ).toBe(false);
  });

  it("is symmetric for arbitrary boxes (property)", () => {
    // Symmetry is the property most likely to break when the three witnesses
    // are reordered or one is dropped, and it holds for any correct predicate.
    fc.assert(
      fc.property(
        fc.integer({ min: -20, max: 20 }),
        fc.integer({ min: -20, max: 20 }),
        fc.integer({ min: 1, max: 15 }),
        fc.integer({ min: 1, max: 15 }),
        fc.integer({ min: -20, max: 20 }),
        fc.integer({ min: -20, max: 20 }),
        (ax, ay, aw, ah, bx, by) => {
          const a = box(ax, ay, ax + aw, ay + ah);
          const b = box(bx, by, bx + aw, by + ah);
          expect(ringsOverlap(a, b)).toBe(ringsOverlap(b, a));
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe("polygonsOverlap — holes are subtracted", () => {
  /** A 20x20 square with a 10x10 hole in the middle. */
  const donut = [box(0, 0, 20, 20), box(5, 5, 15, 15)];

  it("is FALSE for a shape entirely inside the other's hole", () => {
    // The case the ring-vs-ring predicate gets wrong on its own, and the reason
    // this function exists: a courtyard, a clearing, a lake on an island. The
    // small box is inside the outer ring and inside the hole, so the two shapes
    // share no area whatsoever.
    expect(polygonsOverlap(donut, [box(7, 7, 13, 13)])).toBe(false);
    // ...and the ring-only predicate would say otherwise, which is precisely
    // the trap. Asserted so the distinction cannot be optimised away later.
    expect(ringsOverlap(donut[0] as PlanarPoint[], box(7, 7, 13, 13))).toBe(
      true,
    );
  });

  it("is TRUE for a shape that straddles the hole's rim", () => {
    // Partly in the hole, partly on the solid annulus. Shares area, so it
    // overlaps — the boundary between the two cases above and below.
    expect(polygonsOverlap(donut, [box(12, 12, 18, 18)])).toBe(true);
  });

  it("is TRUE for a shape on the solid part only", () => {
    expect(polygonsOverlap(donut, [box(1, 1, 4, 4)])).toBe(true);
  });

  it("is FALSE when each sits in the other's hole", () => {
    // Both directions, because the containment test has to run both ways round
    // and a predicate checking only one would pass this by luck.
    const other = [box(6, 6, 14, 14), box(7, 7, 13, 13)];
    expect(polygonsOverlap(donut, other)).toBe(false);
    expect(polygonsOverlap(other, donut)).toBe(false);
  });

  it("is TRUE when a hole-free shape contains the whole donut", () => {
    // The donut is inside it, and the donut has solid area, so they overlap.
    expect(polygonsOverlap(donut, [box(-5, -5, 25, 25)])).toBe(true);
  });

  it("treats a polygon with no holes exactly as ringsOverlap does", () => {
    // The generalisation must not change the answer for the case that already
    // worked — this is the regression guard on the hoist itself.
    fc.assert(
      fc.property(
        fc.integer({ min: -20, max: 20 }),
        fc.integer({ min: -20, max: 20 }),
        fc.integer({ min: 1, max: 15 }),
        (bx, by, bw) => {
          const a = box(0, 0, 10, 10);
          const b = box(bx, by, bx + bw, by + bw);
          expect(polygonsOverlap([a], [b])).toBe(ringsOverlap(a, b));
        },
      ),
      { numRuns: 100 },
    );
  });
});
