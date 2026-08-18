import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { geometryOverlaps } from "./geometry-overlap.js";
import { containsPoint, type PlanarPoint } from "./point-in-ring.js";
import type { PlanarPolygon } from "./ring-overlap.js";

/**
 * Property run for the geometry-kind predicate.
 *
 * **Moved here from `geometry-overlap.test.ts` (2026-08-10)** to follow the
 * repo's test-layout rule — property-based specs live in `*.property.test.ts`.
 * The examples stay next door; only the generated run moved, with its comment.
 */

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

const QUERY: PlanarPolygon = [box(0, 0, 20, 20)];
const at = (x: number, y: number): PlanarPoint => ({ x, y });

describe("geometryOverlaps — points", () => {
  it("agrees with containsPoint for arbitrary points", () => {
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
