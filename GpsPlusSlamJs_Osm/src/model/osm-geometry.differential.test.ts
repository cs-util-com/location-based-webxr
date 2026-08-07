/**
 * Differential test: our geometry conversion vs. `osmtogeojson`.
 *
 * Why this test matters:
 * The plan's §4.2.1 comparison harness exists so that "we wrote our own" is an
 * evidence-backed claim rather than an assertion. `osmtogeojson` is
 * overpass-turbo's converter — continuously exercised against real Overpass
 * output for a decade — so where it and we disagree, one of us has a bug and
 * finding out which is the entire point.
 *
 * Scope of the comparison, and its limits:
 *  - We compare the AREA/LINE decision and the ring structure, which is what we
 *    actually ported. We do NOT compare coordinate ordering or winding: GeoJSON
 *    mandates a winding convention that our internal model deliberately does not
 *    impose (h3-js does not care, and normalising would cost a pass for nothing).
 *  - `osmtogeojson` is used ONLY here, as a devDependency. It is pinned to
 *    3.0.0-beta.5 because npm's `latest` for this package IS that 2022 beta;
 *    that staleness is a reason not to depend on it at runtime and no reason at
 *    all not to test against it.
 *
 * @see osm-geometry.ts.md
 * @see GpsPlusSlamJs_Docs/docs/2026-07-28-0624-osm-h3-affordance-index-plan.md §4.2.1
 */

import { describe, it, expect } from "vitest";
import osmtogeojson from "osmtogeojson";
import { parseOverpassJson } from "./overpass-parser.js";
import { toGeometry } from "./osm-geometry.js";
import type { OsmGeometry } from "./osm-geometry.js";

/** Our geometry kind mapped onto GeoJSON's vocabulary, for comparison only. */
function toGeoJsonKind(geometry: OsmGeometry): string {
  switch (geometry.kind) {
    case "point":
      return "Point";
    case "linestring":
      return "LineString";
    case "multilinestring":
      // toGeometry never produces this - only clipping does - so it cannot
      // appear in a differential run against osmtogeojson. Handled anyway,
      // because the exhaustive switch is what made adding the kind safe.
      return "MultiLineString";
    case "polygon":
      return "Polygon";
    case "multipolygon":
      return "MultiPolygon";
  }
}

/**
 * `{ "way/123": "Polygon", ... }` for every feature osmtogeojson emits.
 *
 * **The clone is load-bearing, not defensive habit.** `osmtogeojson` MUTATES the
 * payload it is given: for a relation with inlined `out geom` members it
 * rewrites each `member.ref` from the numeric id to a synthetic string
 * (`1` -> `"_fullGeom1"`). Handing it the same object we then parse ourselves
 * silently corrupts our input — our parser correctly rejects the non-numeric
 * `ref`, the members vanish, and the relation fails with `no-outer-ring`. That
 * looked exactly like a bug in our stitcher and was not.
 *
 * This is the first thing the comparison harness bought us, and it is recorded
 * here rather than only in the findings doc because the next person to add a
 * case to this file needs to know before they debug the same ghost.
 */
function theirKinds(payload: unknown): Map<string, string> {
  const isolated = structuredClone(payload);
  const collection = osmtogeojson(isolated) as {
    features: { id: string; geometry: { type: string } | null }[];
  };
  const map = new Map<string, string>();
  for (const feature of collection.features) {
    if (feature.geometry != null) {
      map.set(feature.id, feature.geometry.type);
    }
  }
  return map;
}

/** `{ "way/123": "Polygon", ... }` for every feature WE convert successfully. */
function ourKinds(payload: unknown): Map<string, string> {
  const { features } = parseOverpassJson(payload);
  const map = new Map<string, string>();
  for (const feature of features) {
    const result = toGeometry(feature);
    if (result.ok) {
      map.set(`${feature.type}/${feature.id}`, toGeoJsonKind(result.geometry));
    }
  }
  return map;
}

const P = (lat: number, lon: number) => ({ lat, lon });
const SQUARE = [P(0, 0), P(0, 1), P(1, 1), P(1, 0), P(0, 0)];
const OPEN = [P(0, 0), P(0, 1), P(1, 1)];

const wrap = (elements: unknown[]) => ({ version: 0.6, elements });

const closedWay = (id: number, tags: Record<string, string>) => ({
  type: "way",
  id,
  geometry: SQUARE,
  nodes: [1, 2, 3, 4, 1],
  tags,
});

describe("area-vs-line classification agrees with osmtogeojson", () => {
  // Each case is a tag combination where a naive `closed => polygon` rule (the
  // C# reference's, minus its `highway` special case) would get it wrong.
  const cases: { label: string; tags: Record<string, string> }[] = [
    { label: "building=house", tags: { building: "house" } },
    { label: "landuse=grass", tags: { landuse: "grass" } },
    { label: "leisure=park", tags: { leisure: "park" } },
    { label: "natural=water", tags: { natural: "water" } },
    {
      label: "natural=coastline (blacklisted)",
      tags: { natural: "coastline" },
    },
    { label: "barrier=fence (not whitelisted)", tags: { barrier: "fence" } },
    { label: "barrier=wall (whitelisted)", tags: { barrier: "wall" } },
    {
      label: "highway=footway (the way-449879297 rule)",
      tags: { highway: "footway" },
    },
    { label: "highway=services (whitelisted)", tags: { highway: "services" } },
    { label: "railway=platform (whitelisted)", tags: { railway: "platform" } },
    { label: "railway=rail (not whitelisted)", tags: { railway: "rail" } },
    {
      label: "man_made=pipeline (blacklisted)",
      tags: { man_made: "pipeline" },
    },
    { label: "man_made=bridge (blacklist miss)", tags: { man_made: "bridge" } },
    {
      label: "area=yes forcing an areal reading",
      tags: { highway: "pedestrian", area: "yes" },
    },
    {
      label: "area=no forcing a linear reading",
      tags: { building: "house", area: "no" },
    },
    { label: "amenity=parking", tags: { amenity: "parking" } },
    { label: "waterway=riverbank", tags: { waterway: "riverbank" } },
    { label: "waterway=stream", tags: { waterway: "stream" } },
  ];

  it.each(cases)("closed way tagged $label", ({ tags }) => {
    const payload = wrap([closedWay(1, tags)]);
    expect(ourKinds(payload).get("way/1")).toBe(
      theirKinds(payload).get("way/1"),
    );
  });

  it("an open way is a LineString for both, whatever it is tagged", () => {
    const payload = wrap([
      {
        type: "way",
        id: 2,
        geometry: OPEN,
        nodes: [1, 2, 3],
        tags: { building: "house" },
      },
    ]);
    expect(ourKinds(payload).get("way/2")).toBe("LineString");
    expect(theirKinds(payload).get("way/2")).toBe("LineString");
  });

  it("a tagged node is a Point for both", () => {
    const payload = wrap([
      {
        type: "node",
        id: 3,
        lat: 50.94,
        lon: 6.95,
        tags: { amenity: "bench" },
      },
    ]);
    expect(ourKinds(payload).get("node/3")).toBe("Point");
    expect(theirKinds(payload).get("node/3")).toBe("Point");
  });
});

describe("multipolygon structure agrees with osmtogeojson", () => {
  const HOLE = [
    P(0.2, 0.2),
    P(0.2, 0.8),
    P(0.8, 0.8),
    P(0.8, 0.2),
    P(0.2, 0.2),
  ];

  it("one outer + one inner is a Polygon with two rings for both", () => {
    const payload = wrap([
      {
        type: "relation",
        id: 10,
        tags: { type: "multipolygon", landuse: "grass" },
        members: [
          { type: "way", ref: 1, role: "outer", geometry: SQUARE },
          { type: "way", ref: 2, role: "inner", geometry: HOLE },
        ],
      },
    ]);
    expect(ourKinds(payload).get("relation/10")).toBe("Polygon");
    expect(theirKinds(payload).get("relation/10")).toBe("Polygon");

    // ...and the ring COUNT matches, which is the part a naive port gets wrong.
    const { features } = parseOverpassJson(payload);
    const result = toGeometry(features[0]!);
    expect(
      result.ok && result.geometry.kind === "polygon" && result.geometry.rings,
    ).toHaveLength(2);
  });

  it("an outer ring split across three open ways stitches to the same ring both sides", () => {
    const a = [P(0, 0), P(0, 1)];
    const b = [P(0, 1), P(1, 1)];
    const c = [P(1, 1), P(1, 0), P(0, 0)];
    const payload = wrap([
      {
        type: "relation",
        id: 11,
        tags: { type: "multipolygon", landuse: "meadow" },
        members: [
          { type: "way", ref: 1, role: "outer", geometry: a },
          { type: "way", ref: 2, role: "outer", geometry: b },
          { type: "way", ref: 3, role: "outer", geometry: c },
        ],
      },
    ]);
    expect(ourKinds(payload).get("relation/11")).toBe("Polygon");
    expect(theirKinds(payload).get("relation/11")).toBe("Polygon");

    // Same set of distinct corners, independent of where each side started it.
    const { features } = parseOverpassJson(payload);
    const result = toGeometry(features[0]!);
    expect(result.ok).toBe(true);
    if (!result.ok || result.geometry.kind !== "polygon") {
      throw new Error("expected a polygon");
    }
    const corners = new Set(
      result.geometry.rings[0]!.map((p) => `${p.lat},${p.lng}`),
    );
    expect(corners).toEqual(new Set(["0,0", "0,1", "1,1", "1,0"]));
  });

  it("two disjoint outer rings is a MultiPolygon for both", () => {
    const far = [P(10, 10), P(10, 11), P(11, 11), P(11, 10), P(10, 10)];
    const payload = wrap([
      {
        type: "relation",
        id: 12,
        tags: { type: "multipolygon", natural: "wood" },
        members: [
          { type: "way", ref: 1, role: "outer", geometry: SQUARE },
          { type: "way", ref: 2, role: "outer", geometry: far },
        ],
      },
    ]);
    expect(ourKinds(payload).get("relation/12")).toBe("MultiPolygon");
    expect(theirKinds(payload).get("relation/12")).toBe("MultiPolygon");
  });
});

describe("where we deliberately differ, and why", () => {
  it("we keep a route relation as a typed error; osmtogeojson emits geometry for it", () => {
    // NOT a bug on either side — a difference of purpose. osmtogeojson is a
    // rendering converter, so a bus route is a perfectly good MultiLineString
    // to draw. We are an AREA-affordance index: a route describes no surface,
    // so scoring it would be meaningless and we reject it by design.
    const payload = wrap([
      {
        type: "relation",
        id: 20,
        tags: { type: "route", route: "bus" },
        members: [{ type: "way", ref: 1, role: "", geometry: OPEN }],
      },
    ]);
    const { features } = parseOverpassJson(payload);
    const result = toGeometry(features[0]!);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error.reason).toBe(
      "unsupported-relation-type",
    );
    // Documents that theirs does produce something here.
    expect(theirKinds(payload).has("relation/20")).toBe(true);
  });
});
