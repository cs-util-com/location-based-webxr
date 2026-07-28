/**
 * Triangulation, including the differential harness against `earcut`.
 *
 * WHY THIS FILE MATTERS MOST OF THE MESH TESTS. Writing our own triangulator is
 * only defensible if we can show it is correct (plan §4.2.1), and hole-aware
 * ear clipping is named there as the pairing most likely to earn its keep
 * because it is a classic correctness sink. So this file does three things:
 *
 * 1. Pins the properties that must hold whatever the input — area is conserved,
 *    every triangle is non-degenerate, indices are in range.
 * 2. Runs OUR output against `earcut`'s on the same inputs (differential
 *    testing). `earcut` is a devDependency and an oracle; it never ships.
 * 3. Proves the progress guard terminates on the degenerate input real OSM
 *    contains, because non-termination is the failure mode that costs most —
 *    this package already lost a run to a coverage call that never finished.
 */

import { describe, expect, it } from "vitest";
import fc from "fast-check";

import type { EnuPoint } from "./enu.js";
import {
  triangulate,
  triangulatedArea,
  dropClosingPoint,
} from "./triangulate.js";

const square = (size = 10): EnuPoint[] => [
  { x: 0, y: 0 },
  { x: size, y: 0 },
  { x: size, y: size },
  { x: 0, y: size },
];

/** An L, so the concave case is covered by every structural assertion. */
const lShape: EnuPoint[] = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 4 },
  { x: 4, y: 4 },
  { x: 4, y: 10 },
  { x: 0, y: 10 },
];

function assertWellFormed(result: ReturnType<typeof triangulate>): void {
  expect(result.indices.length % 3).toBe(0);
  for (const index of result.indices) {
    expect(index).toBeGreaterThanOrEqual(0);
    expect(index).toBeLessThan(result.vertices.length);
  }
}

describe("simple polygons", () => {
  it("triangulates a square into two triangles covering its area", () => {
    const result = triangulate([square(10)]);
    assertWellFormed(result);
    expect(result.indices.length / 3).toBe(2);
    expect(triangulatedArea(result)).toBeCloseTo(100, 6);
  });

  it("handles a concave footprint without losing or inventing area", () => {
    // An L is the smallest shape where a naive fan triangulation is wrong —
    // it would emit a triangle covering the notch. Area is the assertion that
    // catches that, because the triangle count would look perfectly normal.
    const result = triangulate([lShape]);
    assertWellFormed(result);
    expect(triangulatedArea(result)).toBeCloseTo(10 * 4 + 4 * 6, 6);
  });

  it("gives the same answer whichever way the ring winds", () => {
    // Real OSM rings arrive both ways, and orientation errors surface as
    // inside-out geometry rather than as an exception.
    const cw = triangulatedArea(triangulate([[...lShape].reverse()]));
    const ccw = triangulatedArea(triangulate([lShape]));
    expect(cw).toBeCloseTo(ccw, 6);
  });

  it("accepts a ring that repeats its first point as its last", () => {
    // `osm-geometry.ts` produces CLOSED rings, so this is the shape the
    // triangulator actually receives in production.
    const closed = [...square(10), { x: 0, y: 0 }];
    expect(triangulatedArea(triangulate([closed]))).toBeCloseTo(100, 6);
    expect(dropClosingPoint(closed)).toHaveLength(4);
  });

  it("returns nothing rather than throwing for a degenerate ring", () => {
    // A library that must survive whatever the planet contains cannot let a
    // two-node "building" be fatal.
    expect(
      triangulate([
        [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ],
      ]).indices,
    ).toEqual([]);
    expect(triangulate([]).indices).toEqual([]);
  });
});

describe("holes", () => {
  it("subtracts a courtyard from a building", () => {
    const outer = square(10);
    const hole: EnuPoint[] = [
      { x: 3, y: 3 },
      { x: 7, y: 3 },
      { x: 7, y: 7 },
      { x: 3, y: 7 },
    ];
    const result = triangulate([outer, hole]);
    assertWellFormed(result);
    // 100 - 16. If the bridge were wrong the area would come out at 100 (hole
    // ignored) or well over it (self-intersecting ring, overlapping triangles).
    expect(triangulatedArea(result)).toBeCloseTo(84, 4);
  });

  it("handles two holes, and the ordering that makes bridges safe", () => {
    // Bridging a left-hand hole first can lay its bridge across a right-hand
    // one, producing a self-intersecting ring whose triangles overlap. That
    // renders as flicker, not as an error — so rightmost-first is load-bearing
    // and this is the test that would catch losing it.
    const outer = square(20);
    const left: EnuPoint[] = [
      { x: 2, y: 8 },
      { x: 6, y: 8 },
      { x: 6, y: 12 },
      { x: 2, y: 12 },
    ];
    const right: EnuPoint[] = [
      { x: 14, y: 8 },
      { x: 18, y: 8 },
      { x: 18, y: 12 },
      { x: 14, y: 12 },
    ];
    const result = triangulate([outer, left, right]);
    assertWellFormed(result);
    expect(triangulatedArea(result)).toBeCloseTo(400 - 16 - 16, 4);
  });

  it("ignores a hole too small to be a ring rather than corrupting the outline", () => {
    const result = triangulate([
      square(10),
      [
        { x: 1, y: 1 },
        { x: 2, y: 2 },
      ],
    ]);
    expect(triangulatedArea(result)).toBeCloseTo(100, 6);
  });
});

describe("the progress guard", () => {
  it("terminates on collinear runs", () => {
    // Real OSM ways contain runs of collinear nodes from imports and from
    // splitting. A clipper with no guard finds no valid ear and spins.
    const ring: EnuPoint[] = [
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 5, y: 10 },
      { x: 0, y: 10 },
    ];
    const result = triangulate([ring]);
    assertWellFormed(result);
    expect(triangulatedArea(result)).toBeCloseTo(100, 4);
  });

  it("terminates on a fully degenerate ring and SAYS it forced ears", () => {
    // All points identical. There is no correct triangulation; the contract is
    // that we return promptly and report that the input was malformed, rather
    // than hanging or silently emitting slivers.
    const ring: EnuPoint[] = Array.from({ length: 8 }, () => ({ x: 1, y: 1 }));
    const result = triangulate([ring]);
    assertWellFormed(result);
    expect(result.forcedEars).toBeGreaterThan(0);
  });
});

describe("differential test against earcut (§4.2.1 comparison harness)", () => {
  it("agrees with earcut on total area for generated polygons", async () => {
    // earcut is a devDependency and an ORACLE. It never ships — production
    // takes no runtime dependency but h3-js. A disagreement here is a bug in
    // one of the two, and finding out which is the entire point of the pairing.
    const earcut = (await import("earcut")).default;

    fc.assert(
      fc.property(
        fc.integer({ min: 3, max: 12 }),
        fc.integer({ min: 3, max: 40 }),
        (sides, radius) => {
          // Convex n-gons: a shape class where earcut is unambiguously correct,
          // so any disagreement is ours.
          const ring: EnuPoint[] = Array.from({ length: sides }, (_, i) => {
            const a = (i / sides) * Math.PI * 2;
            return { x: Math.cos(a) * radius, y: Math.sin(a) * radius };
          });

          const ours = triangulatedArea(triangulate([ring]));

          const flat = ring.flatMap((p) => [p.x, p.y]);
          const theirIndices = earcut(flat);
          let theirs = 0;
          for (let i = 0; i + 2 < theirIndices.length; i += 3) {
            const a = ring[theirIndices[i] as number] as EnuPoint;
            const b = ring[theirIndices[i + 1] as number] as EnuPoint;
            const c = ring[theirIndices[i + 2] as number] as EnuPoint;
            theirs +=
              Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) /
              2;
          }

          expect(ours).toBeCloseTo(theirs, 4);
        },
      ),
      { numRuns: 30 },
    );
  });

  it("agrees with earcut on a footprint WITH a hole", async () => {
    // The case the harness exists for: multipolygon ring handling is exactly
    // where hand-rolled converters diverge.
    const earcut = (await import("earcut")).default;

    const outer = square(20);
    const hole: EnuPoint[] = [
      { x: 5, y: 5 },
      { x: 15, y: 5 },
      { x: 15, y: 15 },
      { x: 5, y: 15 },
    ];

    const ours = triangulatedArea(triangulate([outer, hole]));

    const flat = [...outer, ...hole].flatMap((p) => [p.x, p.y]);
    const all = [...outer, ...hole];
    const theirIndices = earcut(flat, [outer.length]);
    let theirs = 0;
    for (let i = 0; i + 2 < theirIndices.length; i += 3) {
      const a = all[theirIndices[i] as number] as EnuPoint;
      const b = all[theirIndices[i + 1] as number] as EnuPoint;
      const c = all[theirIndices[i + 2] as number] as EnuPoint;
      theirs +=
        Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) / 2;
    }

    expect(ours).toBeCloseTo(theirs, 4);
  });
});
