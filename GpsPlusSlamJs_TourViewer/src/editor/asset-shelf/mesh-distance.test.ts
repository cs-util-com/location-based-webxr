/**
 * Why these tests matter: the sampled surface distance is the deviation
 * the shelf shows an author and the number the default level of detail is
 * chosen by. If it under-reads, a model loses visible detail under a
 * budget that says it did not; if it is not repeatable, the same file
 * gives a different default each time it is dropped.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { pointTri2, surfaceDistance, SurfaceGrid } from "./mesh-distance.js";
import { heightField, sphere } from "./test-support/meshes.js";

const TRI = [0, 0, 0, 1, 0, 0, 0, 1, 0];

describe("pointTri2", () => {
  it("is zero on the triangle and the squared distance off it, in every region", () => {
    expect(pointTri2(0.25, 0.25, 0, TRI, 0, 3, 6)).toBe(0);
    expect(pointTri2(0.25, 0.25, 2, TRI, 0, 3, 6)).toBeCloseTo(4);
    expect(pointTri2(-1, -1, 0, TRI, 0, 3, 6)).toBeCloseTo(2); // corner a
    expect(pointTri2(2, 0, 0, TRI, 0, 3, 6)).toBeCloseTo(1); // corner b
    expect(pointTri2(0, 3, 0, TRI, 0, 3, 6)).toBeCloseTo(4); // corner c
    expect(pointTri2(0.5, -1, 0, TRI, 0, 3, 6)).toBeCloseTo(1); // edge ab
    expect(pointTri2(-1, 0.5, 0, TRI, 0, 3, 6)).toBeCloseTo(1); // edge ac
    expect(pointTri2(1, 1, 0, TRI, 0, 3, 6)).toBeCloseTo(0.5); // edge bc
  });

  // Why: scans carry zero-area slivers; the interior formula divides by
  // the area there, and a NaN distance would be skipped by every search,
  // so a point over a sliver's edge read the wrong nearest triangle.
  it("measures a zero-area triangle as its longest segment", () => {
    const line = [0, 0, 0, 2, 0, 0, 1, 0, 0];
    expect(pointTri2(1, 1, 0, line, 0, 3, 6)).toBeCloseTo(1);
    const point = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    expect(pointTri2(0, 3, 0, point, 0, 3, 6)).toBeCloseTo(9);
    // the property's shrunk counterexample: two corners equal, the third
    // a hair away, the point between
    expect(
      pointTri2(
        0,
        0,
        5.4803692748773836e-307,
        [0, 0, 0, 0, 0, 0, 0, 0, 4.5075944800480685e-18],
        0,
        3,
        6,
      ),
    ).toBe(0);
  });

  // Why: an area this small still squares to a positive (subnormal)
  // number, so the zero-area guard lets it through, yet the region
  // products underflow to zero and the interior division read 0/0. The
  // property found it; a NaN would be skipped by every nearest search.
  it("never reads NaN for a sliver whose region products underflow", () => {
    const sliver = [
      0, -4.736700232267324e-78, 0, 0, 3.2046759087022053e-77, 0,
      -1.373463448095496e-85, 1.5196073303672403e-90, 0,
    ];
    const d = pointTri2(0, 0, 0, sliver, 0, 3, 6);
    expect(d).toBeGreaterThanOrEqual(0);
    expect(d).toBeLessThan(1e-150);
  });

  // Why: the same underflow can leave the interior's area sum a nonzero
  // subnormal, whose reciprocal overflows to Infinity; an infinite
  // distance passes a plain >= 0 check and makes the nearest search skip
  // the triangle the point lies on.
  it("never reads Infinity for a tiny triangle whose area sum underflows", () => {
    const s = 1e-78;
    const tiny = [0, 0, 0, 2 * s, s, s, s, 2 * s, s];
    // the point at the centroid
    const d = pointTri2(s, s, (2 * s) / 3, tiny, 0, 3, 6);
    expect(Number.isFinite(d)).toBe(true);
    expect(d).toBeLessThan(1e-150);
  });

  // Why: this sliver's squared area is the smallest subnormal, not zero, so
  // the zero-area guard lets it through; the region tests then subtract
  // near-equal products, read rounding noise as a sign, and fall into the
  // interior branch with a garbage weight.
  // The property found it reading corner a (25) for a point on corner c.
  it("measures a sliver whose region tests read rounding noise by its segments", () => {
    const sliver = [
      0, 0, 0, 7.86781753728706e-12, 0, 0, -5, 0, 1.9976667954663626e-151,
    ];
    const d = pointTri2(-4.9999999999999885, 0, 0, sliver, 0, 3, 6);
    // the point lies about 2e-151 from edge ac (about 4e-302 squared); the
    // bound is its distance to corner c, 1.2e-14 (about 1.3e-28 squared),
    // which the segments never exceed, against the 25 the bug read
    expect(d).toBeLessThan(1e-27);
  });

  // Why: a thin but real triangle (height 1e-4 of its edge) must keep its
  // interior: measured by its segments, a point inside it would read the
  // square of its distance to the nearest edge (6.25e-10 here). This pins
  // the squared sliver threshold from above, to below 1e-8, which the
  // corner property cannot (segments never exceed a corner). It checks the
  // three rotations (each corner as `a`), so the threshold does not depend
  // on which corner is passed first; it does not pin the edge set (leaving
  // `bc` out of the longest edge would only lower the threshold).
  it("measures a thin but real triangle by its interior, with each corner as a", () => {
    const thin = [0, 0, 0, 1, 0, 0, 0.5, 0, 1e-4];
    for (const [a, b, c] of [
      [0, 3, 6],
      [3, 6, 0],
      [6, 0, 3],
    ] as const) {
      expect(pointTri2(0.5, 0, 2.5e-5, thin, a, b, c)).toBeLessThan(1e-12);
    }
  });

  // Why: the closest point can never be farther than any corner.
  it("is never farther than the nearest corner (property)", () => {
    const c = fc.double({ min: -5, max: 5, noNaN: true });
    fc.assert(
      fc.property(fc.array(c, { minLength: 12, maxLength: 12 }), (v) => {
        const P = v.slice(0, 9);
        const [px, py, pz] = v.slice(9) as [number, number, number];
        const d = pointTri2(px, py, pz, P, 0, 3, 6);
        const corner = Math.min(
          ...[0, 3, 6].map(
            (o) =>
              (px - P[o]!) ** 2 + (py - P[o + 1]!) ** 2 + (pz - P[o + 2]!) ** 2,
          ),
        );
        expect(d).toBeGreaterThanOrEqual(0);
        expect(d).toBeLessThanOrEqual(corner * (1 + 1e-9) + 1e-12);
      }),
    );
  });
});

/** `n` long triangles in one plane, each from a corner of the unit square
 *  to the opposite one: terrain strips, a CAD fan, a ground quad split
 *  along its diagonal. Unindexed, so each triangle has its own corners. */
function longTriangles(n: number): { P: Float32Array; I: Uint32Array } {
  const P = new Float32Array(n * 9);
  for (let i = 0; i < n; i++) {
    P.set([0, 0, 0, 1, 1, 0, 1 - (i + 1) / n, 1, 0], 9 * i);
  }
  return { P, I: Uint32Array.from({ length: 3 * n }, (_, k) => k) };
}

/** `base` with one more triangle in its z = 0 plane, from (x0, y) to
 *  (x1, y) and (x1, y + h). */
function withTriangle(
  base: { P: Float32Array; I: Uint32Array },
  x0: number,
  x1: number,
  y: number,
  h: number,
): { P: Float32Array; I: Uint32Array } {
  const P = new Float32Array(base.P.length + 9);
  P.set(base.P);
  P.set([x0, y, 0, x1, y, 0, x1, y + h, 0], base.P.length);
  return { P, I: Uint32Array.from({ length: P.length / 3 }, (_, k) => k) };
}

describe("SurfaceGrid", () => {
  // Why: the grid used to put a triangle into every cell of its bounding
  // box. A flat mesh of long triangles has about T/2 cells and each such
  // triangle's box covers nearly all of them: 1 000 of them over the unit
  // square get 37 x 37 x 1 = 1 369 cells and the grid held about 1.4
  // million entries; at 10 000, 80 x 80 x 1 = 6 400 cells and about 64
  // million, past a phone Worker's memory, and the level-of-detail pass
  // builds one per pose. Its size must stay linear in the triangle count,
  // whatever their shape: a triangle covering 32 cells is filed in them,
  // one covering 33 goes to the large list as a single entry.
  it("holds a number of entries linear in the triangles, for long ones too", () => {
    const n = 1000;
    const base = longTriangles(n);
    const { P, I } = base;
    const grid = new SurfaceGrid(P, I);
    // every long triangle covers more than 32 cells: one entry each
    expect(grid.entries).toBe(n);
    // the grid's cell for 1 001 triangles over this flat square, by its
    // sizing rule (about two triangles a cell, the flat axis at 1 %)
    const cell = Math.cbrt(0.01 / ((n + 1) / 2));
    for (const [cells, entries] of [
      [32, n + 32],
      [33, n + 1],
    ] as const) {
      const probe = withTriangle(
        base,
        0.5 * cell,
        (cells - 0.5) * cell,
        0.5 * cell,
        0.1 * cell,
      );
      expect(new SurfaceGrid(probe.P, probe.I).entries).toBe(entries);
    }
    // and its answers stay those of a search over every triangle
    for (const [x, y, z] of [
      [0.5, 0.5, 0.3],
      [2, -1, 0],
      [0.9, 0.1, -0.2],
    ] as const) {
      let best = Infinity;
      for (let t = 0; t < n; t++) {
        best = Math.min(
          best,
          pointTri2(x, y, z, P, 9 * t, 9 * t + 3, 9 * t + 6),
        );
      }
      expect(grid.nearest(x, y, z)).toBe(Math.sqrt(best));
    }
  });
});

describe("surfaceDistance", () => {
  it("reads zero between a mesh and itself, and is the same on every call", () => {
    const m = sphere(2);
    const a = surfaceDistance(m.positions, m.indices, m.positions, m.indices);
    expect(a.max).toBeLessThan(1e-12);
    const lifted = m.positions.map((x, i) => (i % 3 === 1 ? x + 0.01 : x));
    const b = surfaceDistance(m.positions, m.indices, lifted, m.indices, 2000);
    expect(
      surfaceDistance(m.positions, m.indices, lifted, m.indices, 2000),
    ).toEqual(b);
  });

  // Why: lifting a closed surface by h moves no point by more than h, and
  // the top and bottom move by nearly h, so the largest distance must read
  // close to h from below - this is what makes it a usable deviation.
  it("reads a closed sphere lifted by h as close to h, never above it", () => {
    const m = sphere(3);
    for (const h of [0.001, 0.01, 0.05]) {
      const lifted = m.positions.map((x, i) => (i % 3 === 1 ? x + h : x));
      const d = surfaceDistance(
        m.positions,
        m.indices,
        lifted,
        m.indices,
        4000,
      );
      expect(d.max).toBeLessThanOrEqual(h * (1 + 1e-6));
      expect(d.max).toBeGreaterThan(h * 0.8);
    }
  });

  // Why: a flat plate has no volume; a grid sized by volume alone shrank
  // its cells towards zero and ran out of memory.
  it("measures a flat mesh quickly", () => {
    const flat = heightField(8, () => 0, 10);
    const up = heightField(8, () => 0.002, 10);
    const d = surfaceDistance(
      flat.positions,
      flat.indices,
      up.positions,
      up.indices,
      2000,
    );
    expect(d.max).toBeCloseTo(0.02, 6);
  });

  it("reuses a grid of the first mesh with the same answer", () => {
    const m = heightField(6, (u, v) => 0.1 * Math.sin(4 * u + v));
    const flat = heightField(6, () => 0);
    const grid = new SurfaceGrid(m.positions, m.indices);
    expect(
      surfaceDistance(
        m.positions,
        m.indices,
        flat.positions,
        flat.indices,
        1000,
        grid,
      ),
    ).toEqual(
      surfaceDistance(
        m.positions,
        m.indices,
        flat.positions,
        flat.indices,
        1000,
      ),
    );
  });

  it("reads an empty mesh against a non-empty one as infinitely far", () => {
    const m = sphere(1);
    expect(
      surfaceDistance(m.positions, m.indices, m.positions, new Uint32Array(0)),
    ).toEqual({ mean: Infinity, max: Infinity });
  });
});
