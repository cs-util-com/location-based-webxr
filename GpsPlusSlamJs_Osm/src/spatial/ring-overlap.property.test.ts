import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { polygonsOverlap, ringsOverlap } from "./ring-overlap.js";
import type { PlanarPoint } from "./point-in-ring.js";

/**
 * Property runs for the exact overlap predicates.
 *
 * **Moved here from `ring-overlap.test.ts` (2026-08-10)** to follow the repo's
 * test-layout rule — property-based specs live in `*.property.test.ts`. The
 * examples stay next door; only the generated runs moved, with their comments.
 *
 * Why these two properties matter: the example tests pin the cases somebody
 * thought of, and these pin the two invariants that hold for **every** input and
 * would break first if a witness were dropped or reordered.
 */

/** An axis-aligned rectangle, as the ring the predicates consume. */
const box = (
  west: number,
  south: number,
  east: number,
  north: number,
): PlanarPoint[] => [
  { x: west, y: south },
  { x: east, y: south },
  { x: east, y: north },
  { x: west, y: north },
];

describe("ringsOverlap", () => {
  it("is symmetric for arbitrary boxes", () => {
    // Symmetry is the property most likely to break when the three witnesses
    // are reordered or one is dropped, and it holds for any correct predicate.
    fc.assert(
      fc.property(
        fc.integer({ min: -20, max: 20 }),
        fc.integer({ min: -20, max: 20 }),
        fc.integer({ min: 1, max: 15 }),
        fc.integer({ min: 1, max: 15 }),
        fc.integer({ min: -20, max: 20 }),
        fc.integer({ min: -20, max: 20 }),
        (ax, ay, aw, ah, bx, by) => {
          const a = box(ax, ay, ax + aw, ay + ah);
          const b = box(bx, by, bx + aw, by + ah);
          expect(ringsOverlap(a, b)).toBe(ringsOverlap(b, a));
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe("polygonsOverlap", () => {
  it("treats a polygon with no holes exactly as ringsOverlap does", () => {
    // The generalisation must not change the answer for the case that already
    // worked — this is the regression guard on the hoist itself.
    fc.assert(
      fc.property(
        fc.integer({ min: -20, max: 20 }),
        fc.integer({ min: -20, max: 20 }),
        fc.integer({ min: 1, max: 15 }),
        (bx, by, bw) => {
          const a = box(0, 0, 10, 10);
          const b = box(bx, by, bx + bw, by + bw);
          expect(polygonsOverlap([a], [b])).toBe(ringsOverlap(a, b));
        },
      ),
      { numRuns: 100 },
    );
  });
});
