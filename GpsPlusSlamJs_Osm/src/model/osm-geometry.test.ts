/**
 * Geometry-conversion tests.
 *
 * Why these tests matter:
 * These pin the OSM-element -> geometry rules, which the plan calls "subtle and
 * hard-won". Two things are being defended at once:
 *
 *  1. The C# reference's behaviour, where it is right — above all the closed
 *     way-with-`highway` case (way 449879297), which is the single least
 *     obvious rule in the whole port.
 *  2. The places the C# reference is WRONG and this port deliberately diverges:
 *     it treated every closed non-`highway` way as an area, which mis-handles
 *     `barrier=fence` and `natural=coastline`. We adopt osmtogeojson's
 *     `polygonFeatures` table instead, so those cases are covered here too.
 *
 * A relation that cannot be closed must degrade to a typed error, NOT throw:
 * the C# reference throws, which is wrong for a library that has to survive
 * whatever the real planet contains.
 *
 * @see osm-geometry.ts.md
 */

import { describe, it, expect } from "vitest";
import { toGeometry, isAreaWay } from "./osm-geometry.js";
import type { OsmNode, OsmWay, OsmRelation, LatLng } from "./osm-feature.js";

// ---------------------------------------------------------------------------
// Builders. Coordinates are a small square near Cologne; exact values are
// irrelevant to these rules, only topology matters.
// ---------------------------------------------------------------------------
const P = (lat: number, lng: number): LatLng => ({ lat, lng });
const SQUARE: LatLng[] = [P(0, 0), P(0, 1), P(1, 1), P(1, 0), P(0, 0)];
const OPEN_LINE: LatLng[] = [P(0, 0), P(0, 1), P(1, 1)];

const node = (tags: Record<string, string> = {}): OsmNode => ({
  type: "node",
  id: 1,
  position: P(50.94, 6.95),
  tags,
});

const way = (
  geometry: LatLng[],
  tags: Record<string, string> = {},
  id = 100,
): OsmWay => ({ type: "way", id, geometry, tags });

const relation = (
  members: OsmRelation["members"],
  tags: Record<string, string> = { type: "multipolygon" },
): OsmRelation => ({ type: "relation", id: 200, members, tags });

const outer = (geometry: LatLng[], ref = 1) =>
  ({ type: "way", ref, role: "outer", geometry }) as const;
const inner = (geometry: LatLng[], ref = 2) =>
  ({ type: "way", ref, role: "inner", geometry }) as const;

// ---------------------------------------------------------------------------

describe("nodes", () => {
  it("becomes a point", () => {
    const result = toGeometry(node());
    expect(result.ok).toBe(true);
    expect(result.ok && result.geometry).toEqual({
      kind: "point",
      position: P(50.94, 6.95),
    });
  });
});

describe("ways", () => {
  it("an open way becomes a linestring", () => {
    const result = toGeometry(way(OPEN_LINE, { highway: "residential" }));
    expect(result.ok && result.geometry.kind).toBe("linestring");
  });

  it("a closed way with an area-ish tag becomes a polygon", () => {
    const result = toGeometry(way(SQUARE, { building: "house" }));
    expect(result.ok && result.geometry.kind).toBe("polygon");
  });

  // THE way-449879297 RULE. A closed way carrying `highway` is a path that
  // happens to loop back on itself (a circular footpath), not an area. The C#
  // reference hardcodes exactly this case and its test oracle depends on it.
  // osmtogeojson's polygonFeatures reaches the same answer via a whitelist, so
  // adopting the table keeps this oracle valid.
  it("a CLOSED way with `highway` is a LineString, not a polygon (way 449879297)", () => {
    const result = toGeometry(way(SQUARE, { highway: "footway" }, 449879297));
    expect(result.ok && result.geometry.kind).toBe("linestring");
  });

  it("...but a closed `highway=services` IS an area — the table is finer than the C# rule", () => {
    const result = toGeometry(way(SQUARE, { highway: "services" }));
    expect(result.ok && result.geometry.kind).toBe("polygon");
  });

  // The two cases the plan calls out as C# getting wrong.
  it("a closed `barrier=fence` is NOT an area (C# would have made it one)", () => {
    expect(isAreaWay(way(SQUARE, { barrier: "fence" }))).toBe(false);
  });

  it("a closed `barrier=wall` IS an area (whitelisted)", () => {
    expect(isAreaWay(way(SQUARE, { barrier: "wall" }))).toBe(true);
  });

  it("a closed `natural=coastline` is NOT an area (blacklisted)", () => {
    expect(isAreaWay(way(SQUARE, { natural: "coastline" }))).toBe(false);
  });

  it("a closed `natural=water` IS an area (blacklist miss => area)", () => {
    expect(isAreaWay(way(SQUARE, { natural: "water" }))).toBe(true);
  });

  it("`area=yes` forces a polygon even for an otherwise-linear tag", () => {
    expect(isAreaWay(way(SQUARE, { highway: "pedestrian", area: "yes" }))).toBe(
      true,
    );
  });

  it("`area=no` forces a linestring even for an otherwise-areal tag", () => {
    expect(isAreaWay(way(SQUARE, { building: "house", area: "no" }))).toBe(
      false,
    );
  });

  it("an untagged closed way is not an area — no tag says it bounds anything", () => {
    expect(isAreaWay(way(SQUARE, {}))).toBe(false);
  });

  it("a way that is not closed is never an area, whatever it is tagged", () => {
    expect(isAreaWay(way(OPEN_LINE, { building: "house" }))).toBe(false);
  });
});

describe("multipolygon relations", () => {
  it("one outer + one inner becomes a polygon with a hole", () => {
    const hole: LatLng[] = [
      P(0.2, 0.2),
      P(0.2, 0.8),
      P(0.8, 0.8),
      P(0.8, 0.2),
      P(0.2, 0.2),
    ];
    const result = toGeometry(relation([outer(SQUARE), inner(hole)]));
    expect(result.ok).toBe(true);
    if (!result.ok || result.geometry.kind !== "polygon") {
      throw new Error("expected a polygon");
    }
    expect(result.geometry.rings).toHaveLength(2);
    expect(result.geometry.rings[0]).toHaveLength(SQUARE.length);
  });

  it("two outers becomes a multipolygon", () => {
    const second: LatLng[] = [
      P(10, 10),
      P(10, 11),
      P(11, 11),
      P(11, 10),
      P(10, 10),
    ];
    const result = toGeometry(relation([outer(SQUARE, 1), outer(second, 2)]));
    expect(result.ok && result.geometry.kind).toBe("multipolygon");
    if (!result.ok || result.geometry.kind !== "multipolygon") {
      throw new Error("expected a multipolygon");
    }
    expect(result.geometry.polygons).toHaveLength(2);
  });

  // Ported from CombineToClosedArea. This is the case hand-rolled converters
  // most often get wrong.
  it("an outer ring split across three open ways is stitched head-to-tail", () => {
    const a = [P(0, 0), P(0, 1)];
    const b = [P(0, 1), P(1, 1)];
    const c = [P(1, 1), P(1, 0), P(0, 0)];
    const result = toGeometry(
      relation([outer(a, 1), outer(b, 2), outer(c, 3)]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok || result.geometry.kind !== "polygon") {
      throw new Error("expected a polygon");
    }
    const ring = result.geometry.rings[0]!;
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    expect(ring).toHaveLength(5);
  });

  it("stitches even when a segment is stored in reversed order", () => {
    // `b` runs backwards relative to the ring direction. The C# reference
    // handles this by reversing its accumulated result; we handle it by
    // reversing the segment, which generalises to more than one flip.
    const a = [P(0, 0), P(0, 1)];
    const bReversed = [P(1, 1), P(0, 1)];
    const c = [P(1, 1), P(1, 0), P(0, 0)];
    const result = toGeometry(
      relation([outer(a, 1), outer(bReversed, 2), outer(c, 3)]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok || result.geometry.kind !== "polygon") {
      throw new Error("expected a polygon");
    }
    const ring = result.geometry.rings[0]!;
    expect(ring[0]).toEqual(ring[ring.length - 1]);
  });

  // The C# reference throws NotImplementedException here. The plan says fix it.
  it("handles multiple outer rings AND holes (C# throws on this)", () => {
    const first = SQUARE;
    const firstHole: LatLng[] = [
      P(0.2, 0.2),
      P(0.2, 0.8),
      P(0.8, 0.8),
      P(0.8, 0.2),
      P(0.2, 0.2),
    ];
    const second: LatLng[] = [
      P(10, 10),
      P(10, 12),
      P(12, 12),
      P(12, 10),
      P(10, 10),
    ];
    const secondHole: LatLng[] = [
      P(10.5, 10.5),
      P(10.5, 11.5),
      P(11.5, 11.5),
      P(11.5, 10.5),
      P(10.5, 10.5),
    ];
    const result = toGeometry(
      relation([
        outer(first, 1),
        inner(firstHole, 2),
        outer(second, 3),
        inner(secondHole, 4),
      ]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok || result.geometry.kind !== "multipolygon") {
      throw new Error("expected a multipolygon");
    }
    // Each hole must be assigned to the outer ring that actually contains it —
    // not simply attached to the first, which is what a naive port would do.
    expect(result.geometry.polygons).toHaveLength(2);
    for (const poly of result.geometry.polygons) {
      expect(poly).toHaveLength(2);
    }
  });

  it("recognises `type=boundary` as a multipolygon too (C# only knows `multipolygon`)", () => {
    const result = toGeometry(
      relation([outer(SQUARE)], {
        type: "boundary",
        boundary: "protected_area",
      }),
    );
    expect(result.ok && result.geometry.kind).toBe("polygon");
  });
});

describe("degrading instead of throwing — the library-survivability requirement", () => {
  it("a relation whose ways cannot be closed yields a typed error, not an exception", () => {
    const a = [P(0, 0), P(0, 1)];
    const disconnected = [P(5, 5), P(5, 6)];
    let result!: ReturnType<typeof toGeometry>;
    expect(() => {
      result = toGeometry(relation([outer(a, 1), outer(disconnected, 2)]));
    }).not.toThrow();
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error.reason).toBe("unclosable-ring");
    // The error must name the offending element so a human can go look at it.
    expect(result.ok === false && result.error.featureKey).toBe("relation/200");
  });

  it("a non-multipolygon relation yields a typed error rather than NotImplementedException", () => {
    const result = toGeometry(
      relation([outer(SQUARE)], { type: "route", route: "bus" }),
    );
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error.reason).toBe(
      "unsupported-relation-type",
    );
  });

  it("a way with too few positions to be anything yields a typed error", () => {
    const result = toGeometry(way([P(0, 0)], { highway: "residential" }));
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error.reason).toBe(
      "degenerate-geometry",
    );
  });

  it("a relation with no usable outer ring yields a typed error", () => {
    const result = toGeometry(relation([inner(SQUARE)]));
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error.reason).toBe("no-outer-ring");
  });
});
