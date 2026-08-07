/**
 * Segment-versus-ring crossing.
 *
 * Why these tests matter:
 * This is the primitive that makes a wall block. Before it, `nav/obstacles.ts`
 * only ADDED standable levels, so a wall's cell offered the ground and the wall
 * top, and an agent walked along the ground straight through the wall — the
 * `obstacles.test.ts` header says exactly that, and calls this slice the one
 * that fixes it.
 *
 * The two cases that make a naive implementation wrong are both here and both
 * are ordinary rather than exotic:
 *
 * - **Collinear overlap.** All four orientation cross products are zero, so an
 *   orientation-only test reports "no intersection" for two segments lying on
 *   top of each other. A way running along a wall produces this.
 * - **Touching at a point.** Counted as crossing, deliberately: refusing a path
 *   that grazes a wall's corner is the safe direction, because admitting it
 *   clips an agent through geometry at the place a viewer is most likely to be
 *   looking.
 *
 * @see segment-crossing.ts.md
 */

import { describe, expect, it } from "vitest";

import { segmentCrossesRing, segmentsIntersect } from "./segment-crossing.js";

const p = (x: number, y: number) => ({ x, y });

/** The unit square, counter-clockwise. */
const SQUARE = [p(0, 0), p(1, 0), p(1, 1), p(0, 1)];

describe("segmentsIntersect", () => {
  it("finds a plain X crossing", () => {
    expect(segmentsIntersect(p(0, 0), p(2, 2), p(0, 2), p(2, 0))).toBe(true);
  });

  it("rejects two segments that miss each other", () => {
    expect(segmentsIntersect(p(0, 0), p(1, 0), p(0, 1), p(1, 1))).toBe(false);
  });

  it("rejects segments whose INFINITE lines would cross", () => {
    // The distinction the whole predicate exists for: extending both segments
    // meets at (2,2), but neither reaches it. A line-intersection formula
    // without the range test would block a step nowhere near a wall.
    expect(segmentsIntersect(p(0, 0), p(1, 1), p(3, 1), p(4, 2))).toBe(false);
  });

  it("counts a T-junction, where an endpoint lands on the other segment", () => {
    expect(segmentsIntersect(p(0, 0), p(2, 0), p(1, 0), p(1, 1))).toBe(true);
  });

  it("counts collinear overlap", () => {
    // Every cross product is zero here. Orientation alone says "no".
    expect(segmentsIntersect(p(0, 0), p(2, 0), p(1, 0), p(3, 0))).toBe(true);
  });

  it("rejects collinear segments that do not overlap", () => {
    // The other half of the collinear case — without the range check this
    // would join the one above and block every step parallel to a wall.
    expect(segmentsIntersect(p(0, 0), p(1, 0), p(2, 0), p(3, 0))).toBe(false);
  });

  it("counts segments that share one endpoint", () => {
    expect(segmentsIntersect(p(0, 0), p(1, 1), p(1, 1), p(2, 0))).toBe(true);
  });
});

describe("segmentCrossesRing", () => {
  it("crosses a ring it passes through", () => {
    expect(segmentCrossesRing(p(-1, 0.5), p(2, 0.5), SQUARE)).toBe(true);
  });

  it("does not cross a ring it stays outside", () => {
    expect(segmentCrossesRing(p(-1, 2), p(2, 2), SQUARE)).toBe(false);
  });

  it("closes the ring implicitly, so the last edge is not a gap", () => {
    // WITHOUT THE IMPLICIT CLOSE this passes through the missing final edge —
    // a wall with one side open, which lets an agent through at exactly one
    // place and looks like a pathfinding glitch rather than a geometry bug.
    const openSquare = [p(0, 0), p(1, 0), p(1, 1), p(0, 1)];
    expect(segmentCrossesRing(p(-1, 0.5), p(0.5, 0.5), openSquare)).toBe(true);
  });

  it("reports NO crossing for a segment wholly inside the ring", () => {
    // A deliberate limit of this predicate, stated so a caller does not mistake
    // it for containment: it answers "does this step pass through the
    // boundary", and a step from one interior point to another does not.
    // `containsPoint` is the other half of the design's pair.
    expect(segmentCrossesRing(p(0.2, 0.2), p(0.8, 0.8), SQUARE)).toBe(false);
  });

  it("handles a degenerate ring without throwing", () => {
    // A one-node ring is ordinary Overpass output, not a bug to crash on.
    expect(segmentCrossesRing(p(0, 0), p(1, 1), [p(0.5, 0.5)])).toBe(false);
    expect(segmentCrossesRing(p(0, 0), p(1, 1), [])).toBe(false);
  });

  it("crosses when the segment merely touches a corner", () => {
    // Grazing counts. The alternative admits a step that clips the wall.
    expect(segmentCrossesRing(p(-1, -1), p(0, 0), SQUARE)).toBe(true);
  });
});
