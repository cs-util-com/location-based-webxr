/**
 * "Does this feature overlap the query?" — for every geometry kind, not just areas.
 *
 * WHY THIS FILE EXISTS. `ring-overlap.ts` answers for POLYGONS ONLY, and over
 * the site corpus that is a minority of features: 3 316 of 10 335 elements are
 * nodes and most of the 6 777 ways are open. A spatial query built on the
 * polygon predicate alone would silently answer "nothing here" for two thirds of
 * the map — the failure mode this package treats as the worst one, because it
 * looks exactly like an empty area.
 *
 * THE CONTRACT IS EXACT, WITH ZERO TOLERANCE (decision 12.2). A point overlaps
 * when it is inside; a line overlaps when it enters or crosses. No width, no
 * buffer. Two consequences the tests below pin deliberately:
 *
 * - **It composes.** A caller wanting tolerance dilates the QUERY, in one place,
 *   rather than every predicate carrying a width that has to be kept in sync
 *   with the renderer.
 * - **A road you are standing on is a zero-width line**, so "what am I looking
 *   at" misses the thing under your feet unless the caller dilates. That is a
 *   caller obligation, and it is written down here rather than discovered.
 *
 * HOLES COUNT, for every kind. A point in a courtyard is not in the building; a
 * path across a clearing is not in the wood. The polygon predicate already
 * handles this and the point and line cases must agree with it, or the same
 * query returns different answers depending on how a feature happens to be
 * tagged.
 */

import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { geometryOverlaps, toPlanarGeometry } from "./geometry-overlap.js";
import { containsPoint, type PlanarPoint } from "./point-in-ring.js";
import type { PlanarPolygon } from "./ring-overlap.js";

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

/** The query used by most cases: a 20x20 box at the origin. */
const QUERY: PlanarPolygon = [box(0, 0, 20, 20)];

/** A 20x20 query with a 10x10 hole — a courtyard in the middle of the view. */
const DONUT_QUERY: PlanarPolygon = [box(0, 0, 20, 20), box(5, 5, 15, 15)];

const at = (x: number, y: number): PlanarPoint => ({ x, y });

describe("geometryOverlaps — points", () => {
  it("is true for a point inside the query and false for one outside", () => {
    expect(
      geometryOverlaps({ kind: "point", position: at(10, 10) }, QUERY),
    ).toBe(true);
    expect(
      geometryOverlaps({ kind: "point", position: at(30, 30) }, QUERY),
    ).toBe(false);
  });

  it("is FALSE for a point in the query's hole", () => {
    // Why this test matters: the point sits inside the query's outer ring, so a
    // predicate that only ray-casts the outer would say yes. Standing in a
    // courtyard is not standing in the building, and the polygon predicate
    // already agrees — the kinds must not disagree with each other.
    expect(
      geometryOverlaps({ kind: "point", position: at(10, 10) }, DONUT_QUERY),
    ).toBe(false);
    expect(
      geometryOverlaps({ kind: "point", position: at(2, 2) }, DONUT_QUERY),
    ).toBe(true);
  });

  it("agrees with containsPoint for arbitrary points (property)", () => {
    // The point case must be exactly the existing predicate and nothing more —
    // no tolerance, no epsilon. This is the regression guard on that.
    fc.assert(
      fc.property(
        fc.integer({ min: -30, max: 50 }),
        fc.integer({ min: -30, max: 50 }),
        (x, y) => {
          expect(
            geometryOverlaps({ kind: "point", position: at(x, y) }, QUERY),
          ).toBe(containsPoint(QUERY[0] as PlanarPoint[], at(x, y)));
        },
      ),
      { numRuns: 50 },
    );
  });
});

describe("geometryOverlaps — lines", () => {
  it("is true when a vertex lies inside the query", () => {
    expect(
      geometryOverlaps(
        { kind: "linestring", positions: [at(10, 10), at(50, 50)] },
        QUERY,
      ),
    ).toBe(true);
  });

  it("is true for a line that crosses clean through, with NO vertex inside", () => {
    // The case a vertex-only test misses entirely, and the everyday one: a road
    // running past the camera whose OSM nodes happen to fall outside the view.
    // Nothing about the vertices reveals it; only the segment crossing does.
    expect(
      geometryOverlaps(
        { kind: "linestring", positions: [at(-10, 10), at(30, 10)] },
        QUERY,
      ),
    ).toBe(true);
  });

  it("is false for a line entirely outside", () => {
    expect(
      geometryOverlaps(
        { kind: "linestring", positions: [at(30, 30), at(40, 40)] },
        QUERY,
      ),
    ).toBe(false);
  });

  it("is FALSE for a line lying wholly inside the query's hole", () => {
    // A path across a courtyard: inside the outer ring, sharing no area with the
    // query's solid part. Same trap as the point case, and the same answer.
    expect(
      geometryOverlaps(
        { kind: "linestring", positions: [at(7, 7), at(13, 13)] },
        DONUT_QUERY,
      ),
    ).toBe(false);
  });

  it("is TRUE for a line that leaves the hole across its rim", () => {
    // The boundary between the two cases above: part of it is on solid ground,
    // so it overlaps. Tested because the obvious implementation of the case
    // above — "all vertices in a hole" — gets this one wrong when the crossing
    // happens between two vertices that are both in the hole.
    expect(
      geometryOverlaps(
        { kind: "linestring", positions: [at(7, 7), at(30, 30)] },
        DONUT_QUERY,
      ),
    ).toBe(true);
  });

  it("is false for a line with too few points to have any extent", () => {
    // Real Overpass output contains one-node and empty ways; a library that has
    // to survive the planet cannot make one fatal.
    expect(geometryOverlaps({ kind: "linestring", positions: [] }, QUERY)).toBe(
      false,
    );
  });

  it("treats a single-point line as that point", () => {
    // Degenerate but real. Answering "false" for a node that IS in view would be
    // a silent miss, which is the failure mode this module exists to avoid.
    expect(
      geometryOverlaps({ kind: "linestring", positions: [at(10, 10)] }, QUERY),
    ).toBe(true);
  });
});

describe("geometryOverlaps — multi kinds", () => {
  it("is true when ANY line of a multilinestring overlaps", () => {
    expect(
      geometryOverlaps(
        {
          kind: "multilinestring",
          lines: [
            [at(40, 40), at(50, 50)],
            [at(10, 10), at(12, 12)],
          ],
        },
        QUERY,
      ),
    ).toBe(true);
  });

  it("is false when no line of a multilinestring overlaps", () => {
    expect(
      geometryOverlaps(
        {
          kind: "multilinestring",
          lines: [
            [at(40, 40), at(50, 50)],
            [at(60, 60), at(70, 70)],
          ],
        },
        QUERY,
      ),
    ).toBe(false);
  });

  it("is true when ANY polygon of a multipolygon overlaps", () => {
    expect(
      geometryOverlaps(
        {
          kind: "multipolygon",
          polygons: [[box(40, 40, 50, 50)], [box(5, 5, 8, 8)]],
        },
        QUERY,
      ),
    ).toBe(true);
  });

  it("is false when no polygon of a multipolygon overlaps", () => {
    expect(
      geometryOverlaps(
        {
          kind: "multipolygon",
          polygons: [[box(40, 40, 50, 50)], [box(60, 60, 70, 70)]],
        },
        QUERY,
      ),
    ).toBe(false);
  });
});

describe("geometryOverlaps — polygons delegate, and keep the hole rule", () => {
  it("is false for a polygon sitting in the query's hole", () => {
    expect(
      geometryOverlaps(
        { kind: "polygon", rings: [box(7, 7, 13, 13)] },
        DONUT_QUERY,
      ),
    ).toBe(false);
  });

  it("is true for a polygon on the solid part", () => {
    expect(
      geometryOverlaps(
        { kind: "polygon", rings: [box(1, 1, 4, 4)] },
        DONUT_QUERY,
      ),
    ).toBe(true);
  });
});

describe("toPlanarGeometry", () => {
  it("maps lat/lng onto x/y the way every predicate here expects", () => {
    // x = lng, y = lat. Getting this backwards is the kind of mistake that still
    // produces plausible answers near the equator and nonsense elsewhere, so it
    // is pinned rather than left to the reader of the conversion.
    const planar = toPlanarGeometry({
      kind: "point",
      position: { lat: 51.5, lng: -0.12 },
    });
    expect(planar).toEqual({
      kind: "point",
      position: { x: -0.12, y: 51.5 },
    });
  });

  it("converts every kind without losing structure", () => {
    // Why this test matters: the conversion is the only place the five-kind
    // union is restated, so a kind added to `osm-geometry.ts` and forgotten here
    // would be a compile error at best and a dropped feature at worst.
    const line = toPlanarGeometry({
      kind: "multilinestring",
      lines: [[{ lat: 1, lng: 2 }], [{ lat: 3, lng: 4 }]],
    });
    expect(line).toEqual({
      kind: "multilinestring",
      lines: [[{ x: 2, y: 1 }], [{ x: 4, y: 3 }]],
    });

    const poly = toPlanarGeometry({
      kind: "multipolygon",
      polygons: [[[{ lat: 1, lng: 2 }]]],
    });
    expect(poly).toEqual({
      kind: "multipolygon",
      polygons: [[[{ x: 2, y: 1 }]]],
    });
  });
});
