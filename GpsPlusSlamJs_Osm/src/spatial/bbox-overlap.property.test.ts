import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { bboxOverlapsPolygon } from "./bbox-overlap.js";
import { boundsOf, positionsOf } from "./clip.js";
import {
  geometryOverlaps,
  toPlanarGeometry,
  type PlanarGeometry,
} from "./geometry-overlap.js";
import type { PlanarPoint } from "./point-in-ring.js";
import type { PlanarPolygon } from "./ring-overlap.js";
import type { OsmGeometry } from "../model/osm-geometry.js";

/**
 * THE ONE PROPERTY THAT MATTERS FOR A BROAD-PHASE GUARD.
 *
 * Why this test matters: `bboxOverlapsPolygon` exists to answer "definitely not"
 * cheaply so the exact predicate never runs. A guard like that has exactly one
 * way to be catastrophically wrong — saying "no" about something that does
 * overlap — and the result is a feature silently missing from a query, which is
 * indistinguishable from empty ground. That is the failure mode this package
 * calls its worst.
 *
 * So the contract is an IMPLICATION, not an equivalence:
 *
 *     geometryOverlaps(g, q)  ⟹  bboxOverlapsPolygon(bboxOf(g), q)
 *
 * The converse is deliberately NOT required. A guard is allowed to pass things
 * through that turn out not to overlap — that is the whole point of a cheap
 * conservative test in front of an expensive exact one — and a test asserting
 * equivalence would be asserting that the guard IS the exact predicate.
 *
 * A counting test proving the guard fires lives in `bbox-overlap.test.ts`. It
 * proves usefulness; this proves safety. Both are needed and they are not the
 * same property: a guard that always returns `true` passes this file and is
 * useless, and a guard that always returns `false` passes a naive speed test and
 * empties the map.
 */

/** A small ring, as `x = lng, y = lat` degrees. */
const ring = (): fc.Arbitrary<PlanarPoint[]> =>
  fc
    .tuple(
      fc.double({ min: -1, max: 1, noNaN: true }),
      fc.double({ min: -1, max: 1, noNaN: true }),
      fc.double({ min: 0.01, max: 1, noNaN: true }),
      fc.double({ min: 0.01, max: 1, noNaN: true }),
    )
    .map(([x, y, w, h]) => [
      { x, y },
      { x: x + w, y },
      { x: x + w, y: y + h },
      { x, y: y + h },
    ]);

/** An arbitrary query polygon: a quad, sometimes rotated off the axes. */
const queryPolygon = (): fc.Arbitrary<PlanarPolygon> =>
  fc
    .tuple(
      fc.double({ min: -1, max: 1, noNaN: true }),
      fc.double({ min: -1, max: 1, noNaN: true }),
      fc.double({ min: 0.05, max: 1.5, noNaN: true }),
      fc.double({ min: 0, max: Math.PI, noNaN: true }),
    )
    .map(([cx, cy, r, turn]) => [
      [0, 1, 2, 3].map((corner) => {
        const angle = turn + (corner * Math.PI) / 2;
        return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
      }),
    ]);

/** Every geometry kind, so the guard is exercised against all of them. */
const geometry = (): fc.Arbitrary<OsmGeometry> =>
  fc.oneof(
    fc
      .tuple(
        fc.double({ min: -1, max: 1, noNaN: true }),
        fc.double({ min: -1, max: 1, noNaN: true }),
      )
      .map(([x, y]) => ({ kind: "point", position: { lat: y, lng: x } })),
    ring().map((points) => ({
      kind: "linestring",
      positions: points.map((p) => ({ lat: p.y, lng: p.x })),
    })),
    ring().map((points) => ({
      kind: "polygon",
      rings: [points.map((p) => ({ lat: p.y, lng: p.x }))],
    })),
  ) as fc.Arbitrary<OsmGeometry>;

function planarBbox(geometry: OsmGeometry) {
  return boundsOf(positionsOf(geometry));
}

describe("bboxOverlapsPolygon is a SAFE broad-phase guard", () => {
  it("never rejects something that actually overlaps", () => {
    fc.assert(
      fc.property(geometry(), queryPolygon(), (raw, query) => {
        const bbox = planarBbox(raw);
        if (bbox === undefined) return;
        const planar: PlanarGeometry = toPlanarGeometry(raw);

        // The implication, and only the implication. A `false` here with an
        // overlapping geometry is a feature that would vanish from every query.
        if (!geometryOverlaps(planar, query)) return;
        expect(bboxOverlapsPolygon(bbox, query)).toBe(true);
      }),
      { numRuns: 300 },
    );
  });

  it("agrees with itself however the query's holes are arranged", () => {
    // Holes only ever SHRINK a query, so a guard that ignores them stays
    // conservative — and it must, because reading them would let a candidate be
    // rejected for sitting in a hole the exact test might still find it outside
    // of. Pinned because "just also check the holes" looks like an obvious
    // improvement and is a correctness regression.
    fc.assert(
      fc.property(geometry(), queryPolygon(), ring(), (raw, query, hole) => {
        const bbox = planarBbox(raw);
        if (bbox === undefined) return;
        const outer = query[0];
        if (outer === undefined) return;
        expect(bboxOverlapsPolygon(bbox, [outer, hole])).toBe(
          bboxOverlapsPolygon(bbox, [outer]),
        );
      }),
      { numRuns: 200 },
    );
  });
});
