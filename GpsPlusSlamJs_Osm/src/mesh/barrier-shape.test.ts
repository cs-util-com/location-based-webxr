/**
 * Barrier footprints — turning a line into something with width.
 *
 * Why these tests matter:
 * A barrier is an open WAY, not a ring, so it has no footprint until one is
 * given to it. Everything downstream depends on that footprint being sane:
 * `extrudeBuilding` needs closed rings with real area, and pass B's
 * point-in-obstacle test needs a polygon that actually contains the wall.
 *
 * The shape choice is the substance here — one quad per segment rather than a
 * single buffered outline — and the reason is the case a mitred outline gets
 * wrong: a sharp turn sends the mitre point towards infinity, producing a spike
 * far from the wall that obstructs ground nobody walled off. These tests pin
 * that a hairpin stays local.
 *
 * @see barrier-shape.ts.md
 */

import { describe, expect, it } from "vitest";

import { barrierFootprints, ringArea } from "./barrier-shape.js";
import type { EnuPoint } from "./enu.js";

const p = (x: number, y: number): EnuPoint => ({ x, y });

/** Longest distance of any ring vertex from the origin. */
const spread = (rings: readonly (readonly EnuPoint[])[]): number =>
  Math.max(...rings.flat().map((v) => Math.hypot(v.x, v.y)));

describe("barrierFootprints", () => {
  it("turns one segment into one rectangle of the right size", () => {
    // A 10 m wall 0.5 m thick is a 5 m² footprint. Asserting the AREA rather
    // than the vertices keeps the test honest about what matters and free of
    // a winding convention it would otherwise silently pin.
    const rings = barrierFootprints([p(0, 0), p(10, 0)], 0.5);

    expect(rings).toHaveLength(1);
    expect(rings[0]).toHaveLength(4);
    expect(Math.abs(ringArea(rings[0]!))).toBeCloseTo(10 * 0.5, 6);
  });

  it("straddles the line rather than sitting to one side", () => {
    // The way IS the wall's centreline in OSM, so a footprint offset entirely
    // to one side would put the obstacle next to the wall the viewer sees.
    const rings = barrierFootprints([p(0, 0), p(10, 0)], 2);
    const ys = rings[0]!.map((v) => v.y);

    expect(Math.min(...ys)).toBeCloseTo(-1, 6);
    expect(Math.max(...ys)).toBeCloseTo(1, 6);
  });

  it("gives every segment of a polyline its own quad", () => {
    const rings = barrierFootprints([p(0, 0), p(10, 0), p(10, 10)], 0.5);

    expect(rings).toHaveLength(2);
    for (const ring of rings) {
      expect(Math.abs(ringArea(ring))).toBeCloseTo(10 * 0.5, 6);
    }
  });

  it("keeps a hairpin turn local", () => {
    // THE REASON FOR PER-SEGMENT QUADS. A mitred outline sends the join point
    // to infinity as the turn approaches 180 degrees — here the mitre would be
    // ~57x the thickness away, obstructing ground nobody walled off and
    // drawing a spike across the scene.
    //
    // Per-segment quads cannot do that: every vertex is within half a
    // thickness of its own segment, so the whole footprint stays within half a
    // thickness of the line.
    const thickness = 0.5;
    const rings = barrierFootprints([p(0, 0), p(10, 0), p(0, 0.01)], thickness);

    expect(spread(rings)).toBeLessThan(10 + thickness);
  });

  it("drops a zero-length segment without dropping the rest", () => {
    // Duplicated consecutive nodes are ordinary in OSM. A zero-length segment
    // has no direction, so its normal is NaN — and a NaN vertex propagates
    // into the mesh, where three renders nothing and reports no error.
    const rings = barrierFootprints(
      [p(0, 0), p(0, 0), p(10, 0), p(10, 0)],
      0.5,
    );

    expect(rings).toHaveLength(1);
    for (const vertex of rings[0]!) {
      expect(Number.isFinite(vertex.x)).toBe(true);
      expect(Number.isFinite(vertex.y)).toBe(true);
    }
  });

  it("returns nothing for a degenerate way", () => {
    expect(barrierFootprints([], 0.5)).toEqual([]);
    expect(barrierFootprints([p(1, 1)], 0.5)).toEqual([]);
    expect(barrierFootprints([p(1, 1), p(1, 1)], 0.5)).toEqual([]);
  });

  it("refuses a non-positive or non-finite thickness", () => {
    // A zero-width footprint has no area, so `triangulate` yields nothing and
    // the barrier silently fails to exist — the failure mode with no symptom.
    for (const bad of [0, -1, NaN, Infinity]) {
      expect(
        () => barrierFootprints([p(0, 0), p(1, 0)], bad),
        String(bad),
      ).toThrow(/thickness/i);
    }
  });

  it("produces rings with a consistent winding", () => {
    // `triangulate` treats the first ring as the outer boundary and the sign
    // of its area as its orientation. Quads that disagreed with each other
    // would extrude with their faces pointing opposite ways — a wall lit from
    // inside, which reads as a rendering bug rather than a geometry one.
    const rings = barrierFootprints(
      [p(0, 0), p(10, 0), p(10, 10), p(0, 10)],
      0.5,
    );
    const signs = rings.map((ring) => Math.sign(ringArea(ring)));

    expect(new Set(signs).size).toBe(1);
  });
});

describe("ringArea", () => {
  it("gives the signed shoelace area", () => {
    // Exported because the assertions above depend on it, and a helper that
    // reimplemented the shoelace inside the test could agree with itself while
    // disagreeing with the geometry.
    const square = [p(0, 0), p(2, 0), p(2, 2), p(0, 2)];
    expect(ringArea(square)).toBeCloseTo(4, 9);
    expect(ringArea([...square].reverse())).toBeCloseTo(-4, 9);
  });

  it("is zero for a degenerate ring", () => {
    expect(ringArea([p(0, 0), p(1, 1)])).toBe(0);
    expect(ringArea([])).toBe(0);
  });
});
