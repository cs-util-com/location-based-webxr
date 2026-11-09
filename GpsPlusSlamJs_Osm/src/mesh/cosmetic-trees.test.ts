import { describe, expect, it } from "vitest";

import type { LatLng, OsmFeature } from "../model/osm-feature.js";
import type { Bbox } from "../spatial/clip.js";
import {
  COSMETIC_WOOD_DENSITY_PER_M2,
  ORCHARD_HEIGHT_M,
  TREE_ROW_SPACING_M,
  buildCosmeticTrees,
  cosmeticRank,
  cosmeticTreeSource,
} from "./cosmetic-trees.js";
import { enuFrameAt, type EnuPoint } from "./enu.js";
import { DEFAULT_TREE_HEIGHT_M } from "./trees.js";

/**
 * WHY THESE TESTS MATTER. Cosmetic trees are invented, so every rule here is
 * about where an invention may NOT go (outside the area, inside a hole, on a
 * building, on a road, outside the fetched window) and about staying the same
 * tree on every build (the rank order a governor thins by). A wrong rule
 * draws a forest on a road or through a house, which reads as a broken map.
 */
const ORIGIN = { lat: 47.903, lng: 8.107 };
const frame = enuFrameAt(ORIGIN);
const at = (x: number, y: number): LatLng => frame.toLatLng({ x, y });
const square = (x0: number, y0: number, x1: number, y1: number): LatLng[] => [
  at(x0, y0),
  at(x1, y0),
  at(x1, y1),
  at(x0, y1),
  at(x0, y0),
];
/** A window far larger than any test area. */
const WIDE: Bbox = { south: 47.8, west: 8.0, north: 48.0, east: 8.2 };

let nextId = 1;
function wood(ring: LatLng[], tags: Record<string, string> = {}): OsmFeature {
  return {
    type: "way",
    id: nextId++,
    tags: { landuse: "forest", ...tags },
    geometry: ring,
  };
}

function woodWithHole(outer: LatLng[], hole: LatLng[]): OsmFeature {
  return {
    type: "relation",
    id: nextId++,
    tags: { type: "multipolygon", natural: "wood" },
    members: [
      { type: "way", ref: 1, role: "outer", geometry: outer },
      { type: "way", ref: 2, role: "inner", geometry: hole },
    ],
  };
}

const build = (
  features: OsmFeature[],
  extra: Partial<Parameters<typeof buildCosmeticTrees>[1]> = {},
) => buildCosmeticTrees(features, { frame, window: WIDE, ...extra });

const inSquare = (
  p: EnuPoint,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
) => p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1;

describe("cosmeticTreeSource", () => {
  it("names woods, forests, orchards and tree rows, and nothing else", () => {
    const way = (tags: Record<string, string>): OsmFeature => ({
      type: "way",
      id: 1,
      tags,
      geometry: square(0, 0, 10, 10),
    });
    expect(cosmeticTreeSource(way({ landuse: "forest" }))).toBe("wood");
    expect(cosmeticTreeSource(way({ natural: "wood" }))).toBe("wood");
    expect(cosmeticTreeSource(way({ landuse: "orchard" }))).toBe("orchard");
    expect(cosmeticTreeSource(way({ natural: "tree_row" }))).toBe("tree_row");
    expect(cosmeticTreeSource(way({ natural: "scrub" }))).toBeUndefined();
    expect(
      cosmeticTreeSource({
        type: "node",
        id: 1,
        tags: { natural: "wood" },
        position: ORIGIN,
      }),
    ).toBeUndefined();
  });
});

describe("woods", () => {
  it("scatters one tree per grid cell inside the ring, all cosmetic", () => {
    const trees = build([wood(square(0, 0, 100, 100))]);
    // 1 ha at 0.02 per m2 is 200 trees, give or take the edge cells.
    expect(trees.length).toBeGreaterThan(180);
    expect(trees.length).toBeLessThan(220);
    for (const t of trees) {
      expect(t.cosmetic).toBe(true);
      expect(t.source).toBe("wood");
      expect(inSquare(t.position, 0, 0, 100, 100)).toBe(true);
    }
    expect(new Set(trees.map((t) => t.key)).size).toBe(trees.length);
  });

  it("respects a hole", () => {
    const trees = build([
      woodWithHole(square(0, 0, 100, 100), square(30, 30, 70, 70)),
    ]);
    expect(trees.length).toBeGreaterThan(100);
    expect(trees.some((t) => inSquare(t.position, 31, 31, 69, 69))).toBe(false);
  });

  it("keeps out of excluded rings (building footprints)", () => {
    const house: EnuPoint[] = [
      { x: 20, y: 20 },
      { x: 60, y: 20 },
      { x: 60, y: 60 },
      { x: 20, y: 60 },
    ];
    const free = build([wood(square(0, 0, 100, 100))]);
    const trees = build([wood(square(0, 0, 100, 100))], {
      excludeRings: [house],
    });
    expect(free.some((t) => inSquare(t.position, 20, 20, 60, 60))).toBe(true);
    expect(trees.some((t) => inSquare(t.position, 20, 20, 60, 60))).toBe(false);
  });

  it("keeps a road's half width plus the margin clear", () => {
    // highway=residential is 2 lanes of the default lane width.
    const road: OsmFeature = {
      type: "way",
      id: 999,
      tags: { highway: "residential", width: "6" },
      geometry: [at(-10, 50), at(110, 50)],
    };
    for (const margin of [0, 1, 2]) {
      const trees = build([wood(square(0, 0, 100, 100)), road], {
        roadMarginM: margin,
      });
      const nearest = Math.min(
        ...trees.map((t) => Math.abs(t.position.y - 50)),
      );
      expect(nearest).toBeGreaterThanOrEqual(3 + margin - 1e-6);
      // And the clearance is not much wider than asked: a tree stands within
      // one grid step of the edge.
      expect(nearest).toBeLessThan(3 + margin + 7.5);
    }
  });

  it("places nothing outside the window, even for a wood reaching past it", () => {
    const window: Bbox = {
      south: at(0, 0).lat,
      west: at(0, 0).lng,
      north: at(50, 50).lat,
      east: at(50, 50).lng,
    };
    const trees = build([wood(square(-200, -200, 200, 200))], { window });
    expect(trees.length).toBeGreaterThan(30);
    for (const t of trees) {
      const p = frame.toLatLng(t.position);
      expect(p.lat).toBeGreaterThanOrEqual(window.south - 1e-12);
      expect(p.lat).toBeLessThanOrEqual(window.north + 1e-12);
      expect(p.lng).toBeGreaterThanOrEqual(window.west - 1e-12);
      expect(p.lng).toBeLessThanOrEqual(window.east + 1e-12);
    }
  });

  it("gives two overlapping woods' shared cells to one wood only", () => {
    const a = wood(square(0, 0, 100, 100));
    const b = wood(square(50, 0, 150, 100));
    const both = build([a, b]);
    const alone = build([a]).length + build([b]).length;
    // The overlap (0.5 ha, about 100 cells) is planted once, not twice.
    expect(alone - both.length).toBeGreaterThan(80);
    expect(alone - both.length).toBeLessThan(120);
  });

  it("makes wood trees 1.5 times a lone tree's default height, jittered", () => {
    const trees = build([wood(square(0, 0, 100, 100))]);
    for (const t of trees) {
      expect(t.heightM).toBeGreaterThanOrEqual(
        DEFAULT_TREE_HEIGHT_M * 1.5 * 0.75,
      );
      expect(t.heightM).toBeLessThanOrEqual(DEFAULT_TREE_HEIGHT_M * 1.5 * 1.25);
    }
  });

  it("draws a mixed wood with both forms and a typed wood with its own", () => {
    const mixed = build([wood(square(0, 0, 100, 100), { leaf_type: "mixed" })]);
    const forms = new Set(mixed.map((t) => t.variant));
    expect(forms).toEqual(new Set(["needleleaved", "broadleaved"]));
    const needle = build([
      wood(square(0, 0, 100, 100), { leaf_type: "needleleaved" }),
    ]);
    expect(new Set(needle.map((t) => t.variant))).toEqual(
      new Set(["needleleaved"]),
    );
    const untyped = build([wood(square(0, 0, 100, 100))]);
    expect(new Set(untyped.map((t) => t.variant))).toEqual(
      new Set(["unknown"]),
    );
  });

  it("places nothing for an empty, degenerate or open area", () => {
    expect(build([])).toEqual([]);
    expect(build([wood([at(0, 0), at(10, 0)])])).toEqual([]);
    expect(build([wood([at(0, 0), at(10, 0), at(20, 0), at(0, 0)])])).toEqual(
      [],
    );
    expect(build([wood(square(0, 0, 1, 1))]).length).toBeLessThanOrEqual(1);
  });
});

describe("orchards", () => {
  it("plants a 6 m grid along the longest edge, 4.5 m tall, broadleaved", () => {
    // A 60 x 30 m orchard rotated by 30 degrees.
    const c = Math.cos(Math.PI / 6);
    const s = Math.sin(Math.PI / 6);
    const r = (u: number, v: number) => at(u * c - v * s, u * s + v * c);
    const ring = [r(0, 0), r(60, 0), r(60, 30), r(0, 30), r(0, 0)];
    const orchard: OsmFeature = {
      type: "way",
      id: nextId++,
      tags: { landuse: "orchard" },
      geometry: ring,
    };
    const trees = build([orchard]);
    expect(trees).toHaveLength(10 * 5);
    for (const t of trees) {
      expect(t.source).toBe("orchard");
      expect(t.variant).toBe("broadleaved");
      expect(t.heightM).toBeGreaterThanOrEqual(ORCHARD_HEIGHT_M * 0.75);
      expect(t.heightM).toBeLessThanOrEqual(ORCHARD_HEIGHT_M * 1.25);
      // Back into the orchard's own axes: every tree sits near a cell centre.
      const u = t.position.x * c + t.position.y * s;
      const v = -t.position.x * s + t.position.y * c;
      expect(Math.abs(((u / 6) % 1) - 0.5)).toBeLessThan(0.09);
      expect(Math.abs(((v / 6) % 1) - 0.5)).toBeLessThan(0.09);
    }
  });
});

describe("tree rows", () => {
  const row = (positions: LatLng[]): OsmFeature => ({
    type: "way",
    id: nextId++,
    tags: { natural: "tree_row" },
    geometry: positions,
  });

  it("plants every 8 m, starting half a step in", () => {
    const trees = build([row([at(0, 0), at(80, 0)])]);
    expect(
      trees
        .map((t) => Math.round(t.position.x * 1000) / 1000)
        .sort((a, b) => a - b),
    ).toEqual([4, 12, 20, 28, 36, 44, 52, 60, 68, 76]);
    expect(TREE_ROW_SPACING_M).toBe(8);
    for (const t of trees) expect(t.source).toBe("tree_row");
  });

  it("carries the spacing across a bend", () => {
    const trees = build([row([at(0, 0), at(10, 0), at(10, 10)])]);
    // 4 and 12 along the polyline: (4, 0) and (10, 2).
    const points = trees
      .map((t) => [
        Math.round(t.position.x * 1e3) / 1e3,
        Math.round(t.position.y * 1e3) / 1e3,
      ])
      .sort((a, b) => a[0]! - b[0]! || a[1]! - b[1]!);
    expect(points).toEqual([
      [4, 0],
      [10, 2],
    ]);
  });

  it("drops a row tree within 4 m of a mapped tree, and only that one", () => {
    const mapped: OsmFeature = {
      type: "node",
      id: nextId++,
      tags: { natural: "tree" },
      position: at(21, 0),
    };
    const trees = build([row([at(0, 0), at(80, 0)]), mapped]);
    const xs = trees.map((t) => Math.round(t.position.x)).sort((a, b) => a - b);
    expect(xs).toEqual([4, 12, 28, 36, 44, 52, 60, 68, 76]);
  });
});

describe("cap and order", () => {
  it("returns placements in rank order", () => {
    const trees = build([wood(square(0, 0, 100, 100))]);
    const ranks = trees.map((t) => cosmeticRank(t.key));
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
  });

  it("keeps the lowest-ranked trees when capped, spread over the whole wood", () => {
    const big = wood(square(0, 0, 200, 200));
    const all = build([big]);
    const capped = build([big], { cap: 100 });
    expect(capped.map((t) => t.key)).toEqual(
      all.slice(0, 100).map((t) => t.key),
    );
    // Evenly thinned: every quarter of the wood keeps some.
    for (const [x0, y0] of [
      [0, 0],
      [100, 0],
      [0, 100],
      [100, 100],
    ] as const) {
      expect(
        capped.filter((t) => inSquare(t.position, x0, y0, x0 + 100, y0 + 100))
          .length,
      ).toBeGreaterThan(10);
    }
  });

  it("accepts an infinite cap", () => {
    expect(
      build([wood(square(0, 0, 100, 100))], { cap: Number.POSITIVE_INFINITY })
        .length,
    ).toBe(build([wood(square(0, 0, 100, 100))]).length);
  });
});

describe("options", () => {
  it("throws on a missing or empty window", () => {
    const features = [wood(square(0, 0, 10, 10))];
    expect(() => buildCosmeticTrees(features, { frame } as never)).toThrow(
      RangeError,
    );
    for (const window of [
      { south: 1, west: 0, north: 0, east: 1 },
      { south: 0, west: 1, north: 1, east: 1 },
      { south: Number.NaN, west: 0, north: 1, east: 1 },
    ]) {
      expect(() => buildCosmeticTrees(features, { frame, window })).toThrow(
        RangeError,
      );
    }
  });

  it("throws on a non-positive density or cap and a negative margin", () => {
    const features = [wood(square(0, 0, 10, 10))];
    for (const densityPerM2 of [
      0,
      -0.01,
      Number.NaN,
      Number.POSITIVE_INFINITY,
    ]) {
      expect(() => build(features, { densityPerM2 })).toThrow(RangeError);
    }
    for (const cap of [0, -1, 2.5, Number.NaN]) {
      expect(() => build(features, { cap })).toThrow(RangeError);
    }
    for (const roadMarginM of [-1, Number.NaN]) {
      expect(() => build(features, { roadMarginM })).toThrow(RangeError);
    }
  });

  it("checks the window even with no woods at all", () => {
    expect(() =>
      buildCosmeticTrees([], {
        frame,
        window: { south: 1, west: 0, north: 0, east: 1 },
      }),
    ).toThrow(RangeError);
  });

  it("scales the count with the density", () => {
    const counts = [0.005, 0.01, COSMETIC_WOOD_DENSITY_PER_M2].map(
      (densityPerM2) =>
        build([wood(square(0, 0, 200, 200))], { densityPerM2 }).length,
    );
    expect(counts[0]! / 200).toBeCloseTo(1, 0);
    expect(counts[1]! / 400).toBeCloseTo(1, 0);
    expect(counts[2]! / 800).toBeCloseTo(1, 0);
  });
});
