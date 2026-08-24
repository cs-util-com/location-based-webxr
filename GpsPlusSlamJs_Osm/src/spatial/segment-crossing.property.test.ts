/**
 * Segment-crossing properties.
 *
 * Why these tests matter:
 * The example suite pins the cases someone thought of. The failure mode this
 * primitive actually has is arithmetic — sign errors and degenerate inputs that
 * only show on coordinates nobody would pick by hand — and it decides whether an
 * agent walks through a wall, which is the single behaviour the whole navigation
 * feature exists to prevent.
 *
 * The relationship with `containsPoint` is the load-bearing one and is checked
 * directly: **a segment from inside a ring to outside it must cross the ring.**
 * That ties the design's two pass-B primitives together, so they cannot drift
 * into disagreeing about the same wall.
 *
 * @see segment-crossing.ts.md
 */

import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { segmentCrossesRing, segmentsIntersect } from "./segment-crossing.js";
import { containsPoint } from "./point-in-ring.js";

const coord = fc.integer({ min: -20, max: 20 });
const point = fc.record({ x: coord, y: coord });

/** The unit square scaled to 10, so integer points fall inside and outside. */
const SQUARE = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
  { x: 0, y: 10 },
];

describe("segment-crossing properties", () => {
  it("is symmetric in both segments and in each segment's direction", () => {
    // Four ways to phrase the same question. An implementation that answered
    // them differently would make a route depend on which cell the search
    // happened to expand from — the determinism problem one layer up.
    fc.assert(
      fc.property(point, point, point, point, (a, b, c, d) => {
        const base = segmentsIntersect(a, b, c, d);
        expect(segmentsIntersect(b, a, c, d)).toBe(base);
        expect(segmentsIntersect(a, b, d, c)).toBe(base);
        expect(segmentsIntersect(c, d, a, b)).toBe(base);
      }),
    );
  });

  it("crosses the ring whenever it runs from inside to outside", () => {
    // THE PROPERTY THAT TIES THE TWO PRIMITIVES TOGETHER. If this can fail,
    // there is a step that starts inside a building and ends in the street
    // without ever passing through a wall — which is precisely the bug the
    // feature exists to prevent, and it would be invisible in any test whose
    // fixture happens to straddle an edge cleanly.
    fc.assert(
      fc.property(point, point, (a, b) => {
        const aIn = containsPoint(SQUARE, a);
        const bIn = containsPoint(SQUARE, b);
        if (aIn === bIn) return;
        expect(segmentCrossesRing(a, b, SQUARE)).toBe(true);
      }),
    );
  });

  it("never reports a crossing for a segment that stays well outside", () => {
    // The mirror direction, and the one that would make the demo useless in the
    // other way: an over-eager predicate produces detours with no visible cause,
    // which reads as broken pathfinding rather than as a wall.
    fc.assert(
      fc.property(
        fc.record({
          x: fc.integer({ min: 20, max: 40 }),
          y: fc.integer({ min: -40, max: 40 }),
        }),
        fc.record({
          x: fc.integer({ min: 20, max: 40 }),
          y: fc.integer({ min: -40, max: 40 }),
        }),
        (a, b) => {
          expect(segmentCrossesRing(a, b, SQUARE)).toBe(false);
        },
      ),
    );
  });

  it("is unchanged by rotating the ring's vertex order", () => {
    // A ring is a cycle, so where the caller happens to start listing it is not
    // information. This is what pins the implicit close: an implementation that
    // dropped the wrap-around edge would answer differently per rotation.
    fc.assert(
      fc.property(point, point, fc.nat({ max: 3 }), (a, b, shift) => {
        const rotated = [...SQUARE.slice(shift), ...SQUARE.slice(0, shift)];
        expect(segmentCrossesRing(a, b, rotated)).toBe(
          segmentCrossesRing(a, b, SQUARE),
        );
      }),
    );
  });
});
