/**
 * Ray-casting point-in-ring.
 *
 * Why these tests matter:
 * This was private to `mesh/buildings.ts` and covered only through building
 * assignment, so its own edge cases were never stated. It is now shared with
 * the navigation obstacle test, where being wrong means an agent walking
 * through a wall or refusing to cross open ground — neither of which announces
 * itself.
 *
 * The case worth pinning hardest is the CONCAVE one. A convex ring gives the
 * same answer for almost any half-correct implementation, so a suite built only
 * on squares cannot tell ray casting from a bounding-box test.
 *
 * @see point-in-ring.ts.md
 */

import { describe, expect, it } from "vitest";

import { containsPoint, type PlanarPoint } from "./point-in-ring.js";

const p = (x: number, y: number): PlanarPoint => ({ x, y });

const SQUARE = [p(0, 0), p(10, 0), p(10, 10), p(0, 10)];

/** A C shape: the bite is taken out of the right-hand side. */
const C_SHAPE = [
  p(0, 0),
  p(10, 0),
  p(10, 3),
  p(4, 3),
  p(4, 7),
  p(10, 7),
  p(10, 10),
  p(0, 10),
];

describe("containsPoint", () => {
  it("accepts an interior point and rejects an exterior one", () => {
    expect(containsPoint(SQUARE, p(5, 5))).toBe(true);
    expect(containsPoint(SQUARE, p(15, 5))).toBe(false);
    expect(containsPoint(SQUARE, p(-1, 5))).toBe(false);
    expect(containsPoint(SQUARE, p(5, 20))).toBe(false);
  });

  it("rejects the concave bite, which a bounding box would accept", () => {
    // THE TEST THAT SEPARATES RAY CASTING FROM A BOX CHECK. (7, 5) is inside
    // the C's bounding box and outside the C. A courtyard building is exactly
    // this shape, and so is a wall bent around a corner.
    expect(containsPoint(C_SHAPE, p(7, 5))).toBe(false);
    // ...while the arms of the C are genuinely inside.
    expect(containsPoint(C_SHAPE, p(7, 1))).toBe(true);
    expect(containsPoint(C_SHAPE, p(7, 9))).toBe(true);
    expect(containsPoint(C_SHAPE, p(2, 5))).toBe(true);
  });

  it("gives the same answer whichever way the ring is wound", () => {
    // Winding is a triangulation concern, not a containment one, and callers
    // hand rings from several sources with no common convention.
    const reversed = [...C_SHAPE].reverse();
    for (const point of [p(7, 5), p(7, 1), p(2, 5), p(15, 15)]) {
      expect(containsPoint(reversed, point), `${point.x},${point.y}`).toBe(
        containsPoint(C_SHAPE, point),
      );
    }
  });

  it("treats the ring as closed without a repeated last vertex", () => {
    // OSM ways repeat the first node to close; ENU rings here usually do not.
    // Both must work, or half the callers get a ring with one open edge —
    // through which every ray escapes.
    const explicit = [...SQUARE, p(0, 0)];
    expect(containsPoint(explicit, p(5, 5))).toBe(true);
    expect(containsPoint(explicit, p(15, 5))).toBe(false);
  });

  it("rejects everything for a degenerate ring", () => {
    // Nothing is inside a line or a point, and a ring that produced `true`
    // here would make a zero-area barrier block the ground it stands on.
    expect(containsPoint([], p(0, 0))).toBe(false);
    expect(containsPoint([p(0, 0)], p(0, 0))).toBe(false);
    expect(containsPoint([p(0, 0), p(1, 1)], p(0.5, 0.5))).toBe(false);
  });

  it("works on lng/lat as x/y without correcting for anisotropy", () => {
    // CROSSING PARITY IS AFFINE-INVARIANT, so scaling one axis cannot change
    // the answer — which is why the obstacle index can ask in degrees while
    // `buildings.ts` asks in metres, with one implementation. Correcting for
    // the latitude scale factor is the obvious instinct and it is wasted work.
    const degrees = SQUARE.map((v) => p(v.x * 1e-5, v.y * 1.6e-5));
    expect(containsPoint(degrees, p(5e-5, 5 * 1.6e-5))).toBe(true);
    expect(containsPoint(degrees, p(15e-5, 5 * 1.6e-5))).toBe(false);
  });
});
