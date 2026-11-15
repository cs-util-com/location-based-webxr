/**
 * Why this property matters: the grid answers a nearest-point query by
 * searching cells outwards and stopping once no nearer triangle can lie
 * farther out, and a triangle too large for its cells is kept in a list
 * every query reads. A triangle missed by either path makes the distance
 * read too large, and the level of detail is then chosen by a deviation
 * that was never there. On random meshes that mix small triangles with
 * long ones (flat and not, and with the per-triangle cell cap lowered so
 * the large list is used often) the grid must give exactly the distance
 * a search over every triangle gives.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { pointTri2, SurfaceGrid } from "./mesh-distance.js";

const coord = fc.double({ min: -5, max: 5, noNaN: true });
const point = fc.tuple(coord, coord, coord);
/** A long triangle (corners anywhere in the box) or a small one (corners
 *  near a centre). */
const triangle = fc.oneof(
  fc.tuple(point, point, point),
  fc
    .tuple(
      point,
      fc.array(fc.double({ min: -0.05, max: 0.05, noNaN: true }), {
        minLength: 9,
        maxLength: 9,
      }),
    )
    .map(([c, d]) =>
      [0, 1, 2].map((v) => [0, 1, 2].map((k) => c[k]! + d[3 * v + k]!)),
    ),
);

describe("SurfaceGrid against every triangle (property)", () => {
  it("gives the nearest distance a search over every triangle gives", () => {
    fc.assert(
      fc.property(
        fc.array(triangle, { minLength: 1, maxLength: 60 }),
        fc.boolean(),
        fc.constantFrom(1, 2, 8, undefined),
        fc.array(fc.tuple(coord, coord, coord), { minLength: 1, maxLength: 8 }),
        (tris, flat, cap, queries) => {
          const P = tris.flatMap((t) =>
            t.flatMap((v) => [v[0], v[1], flat ? 0 : v[2]]),
          );
          const I = Array.from({ length: P.length / 3 }, (_, k) => k);
          const grid = new SurfaceGrid(P, I, cap);
          for (const [x, y, z] of queries) {
            let best = Infinity;
            for (let t = 0; t < tris.length; t++) {
              best = Math.min(
                best,
                pointTri2(x, y, z, P, 9 * t, 9 * t + 3, 9 * t + 6),
              );
            }
            expect(grid.nearest(x, y, z)).toBe(Math.sqrt(best));
          }
        },
      ),
      { seed: 7, numRuns: 300 },
    );
  });
});
