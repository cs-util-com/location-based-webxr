import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { buildHostGrid, type CandidateBounds } from "./host-grid.js";

/**
 * WHY THIS TEST MATTERS. The grid's contract is a pair of properties that hold
 * for EVERY input, and the example test beside it can only ever check the
 * arrangements someone thought of. The two failures this index can cause are
 * both silent — a dropped host looks like ordinary OSM data, a reordered one
 * looks like a plausible different answer — so "no counterexample I could think
 * of" is not the evidence this needs.
 *
 * The generators deliberately produce boxes at wildly different scales, because
 * the interesting behaviour is the boundary between an indexed candidate and an
 * oversized one that goes to the overflow list, and that boundary is a function
 * of the OTHER candidates (the pitch is their mean extent).
 */

const boundsArb = fc
  .record({
    x: fc.integer({ min: -5_000, max: 5_000 }),
    y: fc.integer({ min: -5_000, max: 5_000 }),
    // Spanning four orders of magnitude, so both sides of the overflow
    // threshold are reached without the test naming the threshold.
    size: fc.integer({ min: 1, max: 20_000 }),
  })
  .map(({ x, y, size }): CandidateBounds => {
    const half = size / 2;
    return { minX: x - half, maxX: x + half, minY: y - half, maxY: y + half };
  });

const pointArb = fc.record({
  x: fc.integer({ min: -6_000, max: 6_000 }),
  y: fc.integer({ min: -6_000, max: 6_000 }),
});

/** Every index whose bounds contain the point — the exhaustive answer. */
function scan(
  bounds: readonly CandidateBounds[],
  point: { x: number; y: number },
): number[] {
  const out: number[] = [];
  for (let i = 0; i < bounds.length; i++) {
    const b = bounds[i] as CandidateBounds;
    if (
      point.x >= b.minX &&
      point.x <= b.maxX &&
      point.y >= b.minY &&
      point.y <= b.maxY
    ) {
      out.push(i);
    }
  }
  return out;
}

describe("buildHostGrid properties", () => {
  it("never drops a candidate the exhaustive scan would have found", () => {
    fc.assert(
      fc.property(
        fc.array(boundsArb, { minLength: 1, maxLength: 60 }),
        pointArb,
        (bounds, point) => {
          const hits = new Set(buildHostGrid(bounds).candidatesAt(point));
          for (const expected of scan(bounds, point)) {
            expect(hits.has(expected)).toBe(true);
          }
        },
      ),
    );
  });

  it("always answers in ascending index order", () => {
    fc.assert(
      fc.property(
        fc.array(boundsArb, { minLength: 1, maxLength: 60 }),
        pointArb,
        (bounds, point) => {
          const hits = [...buildHostGrid(bounds).candidatesAt(point)];
          for (let i = 1; i < hits.length; i++) {
            expect(hits[i - 1] as number).toBeLessThan(hits[i] as number);
          }
        },
      ),
    );
  });

  it("never returns an index twice, which would duplicate a host", () => {
    // A candidate spans many cells; inserting it into each is correct, but a
    // query that somehow read two cells would return it twice and the marker
    // would carry the same host in its list more than once.
    fc.assert(
      fc.property(
        fc.array(boundsArb, { minLength: 1, maxLength: 60 }),
        pointArb,
        (bounds, point) => {
          const hits = [...buildHostGrid(bounds).candidatesAt(point)];
          expect(new Set(hits).size).toBe(hits.length);
        },
      ),
    );
  });
});
