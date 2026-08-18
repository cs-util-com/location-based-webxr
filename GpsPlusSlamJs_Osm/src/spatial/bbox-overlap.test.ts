import { describe, expect, it } from "vitest";

import { bboxOverlapsPolygon } from "./bbox-overlap.js";
import type { Bbox } from "./clip.js";
import type { PlanarPoint } from "./point-in-ring.js";

/**
 * Why this test matters: `bbox-overlap.property.test.ts` proves the guard is
 * SAFE — it never rejects a real overlap. A guard that returned `true`
 * unconditionally would pass every line of it and be worthless. This file is the
 * other half: proof that it actually says no, and specifically that it says no in
 * the one case the whole thing was built for.
 *
 * Keep both. Together they bracket the guard from each side; either alone admits
 * a trivially wrong implementation.
 */

const box = (
  west: number,
  south: number,
  east: number,
  north: number,
): Bbox => ({
  west,
  south,
  east,
  north,
});

/**
 * The shape a camera actually sees: narrow at the eye, widening to the far
 * plane. Its bounding box is roughly twice its area, and the difference is where
 * this guard earns its keep.
 */
const FRUSTUM: PlanarPoint[] = [
  { x: -0.05, y: 0 },
  { x: 0.05, y: 0 },
  { x: 1, y: 2 },
  { x: -1, y: 2 },
];

describe("bboxOverlapsPolygon rejects", () => {
  it("THE CASE IT EXISTS FOR: inside the query's bbox, outside the query", () => {
    // A candidate parked in the frustum's bottom-left corner. Its box overlaps
    // the frustum's BOUNDING BOX comfortably — so a packed R-tree broad phase
    // hands it over — while sharing no area with the trapezoid itself.
    //
    // This is the only test here that a bbox-versus-bbox guard would fail, and
    // it is the entire reason this module is not one.
    const corner = box(-0.95, 0.05, -0.6, 0.3);
    expect(bboxOverlapsPolygon(corner, [FRUSTUM])).toBe(false);
  });

  it("a box beyond the query on a plain axis", () => {
    expect(bboxOverlapsPolygon(box(5, 5, 6, 6), [FRUSTUM])).toBe(false);
  });

  it("a query ring that bounds no area", () => {
    // Fewer than three points is not a shape, so nothing can overlap it. The
    // predicates this guards take the same view of a two-node way.
    expect(bboxOverlapsPolygon(box(0, 0, 1, 1), [[{ x: 0, y: 0 }]])).toBe(
      false,
    );
    expect(bboxOverlapsPolygon(box(0, 0, 1, 1), [[]])).toBe(false);
  });
});

describe("bboxOverlapsPolygon admits", () => {
  it("a box squarely inside the query", () => {
    expect(bboxOverlapsPolygon(box(-0.1, 1, 0.1, 1.5), [FRUSTUM])).toBe(true);
  });

  it("a box containing the whole query", () => {
    // No axis can separate them, and the exact test must decide. A guard that
    // reasoned only about the query's vertices would get this backwards.
    expect(bboxOverlapsPolygon(box(-10, -10, 10, 10), [FRUSTUM])).toBe(true);
  });

  it("a box that merely TOUCHES the query's bounding edge", () => {
    // Touching counts as overlapping everywhere in this package, so the guard
    // must pass it through rather than decide. A strict comparison here would
    // make the guard harsher than the predicate it guards, which is the one way
    // a conservative test stops being conservative.
    expect(bboxOverlapsPolygon(box(-3, 0, -1, 2), [FRUSTUM])).toBe(true);
  });

  it("a query carrying a non-finite coordinate, rather than deciding", () => {
    // Declining is always safe; asserting is not. Bad data reaches the exact
    // test, which is written to refuse it — the same reasoning
    // `cell-overlap.ts` uses when it returns `undefined` for "ask h3 instead".
    const broken = [
      { x: 0, y: 0 },
      { x: Number.NaN, y: 1 },
      { x: 1, y: 1 },
    ];
    expect(bboxOverlapsPolygon(box(50, 50, 51, 51), [broken])).toBe(true);
  });

  it("holes, by ignoring them", () => {
    // A hole only shrinks the query. Reading one could reject a candidate that
    // the exact test would still find on solid ground, so the guard is blind to
    // them on purpose — see the module header.
    const hole: PlanarPoint[] = [
      { x: -0.5, y: 1 },
      { x: 0.5, y: 1 },
      { x: 0.5, y: 1.8 },
      { x: -0.5, y: 1.8 },
    ];
    const inHole = box(-0.2, 1.2, 0.2, 1.6);
    expect(bboxOverlapsPolygon(inHole, [FRUSTUM, hole])).toBe(true);
  });
});
