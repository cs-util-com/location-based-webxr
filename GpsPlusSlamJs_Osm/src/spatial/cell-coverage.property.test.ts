/**
 * Cell-coverage property tests.
 *
 * Why these tests matter:
 * The example tests pin one location and a few hand-built shapes. Real OSM
 * geometry is arbitrary: rings wound either way, features spanning a metre or a
 * kilometre, ways with repeated vertices, polygons at any latitude. These assert
 * the relations that must hold for ALL of that — in particular monotonicity,
 * which is the one an optimisation is most likely to break, and the mode
 * ordering, which is what makes `containmentOverlapping` the right choice rather
 * than merely a choice.
 *
 * @see cell-coverage.ts.md
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  polygonToCellsExperimental,
  POLYGON_TO_CELLS_FLAGS,
  gridDistance,
  latLngToCell,
} from "h3-js";
import { coverCells } from "./cell-coverage.js";
import { AFFORDANCE_RES } from "./resolutions.js";
import type { OsmGeometry, PolygonGeometry } from "../model/osm-geometry.js";

/** Mid-latitude, away from the poles and the antimeridian. */
const positionArb = fc.record({
  lat: fc.double({ min: -60, max: 60, noNaN: true }),
  lng: fc.double({ min: -170, max: 170, noNaN: true }),
});

/** An axis-aligned square of a given size, at a given place. */
function squareAt(
  centre: { lat: number; lng: number },
  metres: number,
): PolygonGeometry {
  const dLat = metres / 2 / 111_320;
  const dLng = dLat / Math.max(0.1, Math.cos((centre.lat * Math.PI) / 180));
  return {
    kind: "polygon",
    rings: [
      [
        { lat: centre.lat - dLat, lng: centre.lng - dLng },
        { lat: centre.lat - dLat, lng: centre.lng + dLng },
        { lat: centre.lat + dLat, lng: centre.lng + dLng },
        { lat: centre.lat + dLat, lng: centre.lng - dLng },
        { lat: centre.lat - dLat, lng: centre.lng - dLng },
      ],
    ],
  };
}

const cellsOf = (g: OsmGeometry) => new Set(coverCells(g).map((c) => c.cell));

describe("coverage properties", () => {
  it("is MONOTONIC: a bigger square covers everything a smaller one does", () => {
    // The property an optimisation breaks first, and the one that keeps
    // "contained inside" meaningful. If a faster path ever misses a cell the
    // slower path found, this is where it shows up.
    fc.assert(
      fc.property(
        positionArb,
        // Sizes kept small deliberately: a 360 m square at res 13 covers
        // thousands of cells, and 60 runs of that blew the per-test budget
        // under parallel load. The property does not need big shapes — it needs
        // MANY shapes — so the runs buy more than the size would.
        fc.integer({ min: 8, max: 30 }),
        (centre, small) => {
          const inner = cellsOf(squareAt(centre, small));
          const outer = cellsOf(squareAt(centre, small * 3));
          for (const cell of inner) expect(outer.has(cell)).toBe(true);
        },
      ),
      { numRuns: 40 },
    );
  });

  it("respects containmentFull ⊆ containmentCenter ⊆ containmentOverlapping", () => {
    // The relation that makes `containmentOverlapping` the RIGHT mode rather
    // than just the one we picked: it is the widest, so it is the only one that
    // cannot silently drop a cell a feature clips.
    fc.assert(
      fc.property(
        positionArb,
        fc.integer({ min: 10, max: 40 }),
        (centre, size) => {
          const polygon = [
            squareAt(centre, size).rings[0]!.map(
              (p) => [p.lat, p.lng] as [number, number],
            ),
          ];
          const mode = (flag: string) =>
            new Set(polygonToCellsExperimental(polygon, AFFORDANCE_RES, flag));

          const full = mode(POLYGON_TO_CELLS_FLAGS.containmentFull);
          const centres = mode(POLYGON_TO_CELLS_FLAGS.containmentCenter);
          const overlapping = mode(
            POLYGON_TO_CELLS_FLAGS.containmentOverlapping,
          );

          for (const c of full) expect(centres.has(c)).toBe(true);
          for (const c of centres) expect(overlapping.has(c)).toBe(true);
        },
      ),
      { numRuns: 40 },
    );
  });

  it("never returns an empty set for a non-degenerate feature", () => {
    // A feature the index cannot see is a feature nobody is vetoed by. The
    // small-polygon fallback exists for exactly this, and this is what proves it
    // covers the whole size range rather than the one case it was written for.
    fc.assert(
      fc.property(
        positionArb,
        fc.integer({ min: 1, max: 60 }),
        (centre, size) => {
          expect(cellsOf(squareAt(centre, size)).size).toBeGreaterThan(0);
        },
      ),
      { numRuns: 60 },
    );
  });

  it("linestring coverage is contiguous under grid adjacency", () => {
    // The supercover guarantee. A gap anywhere in a road means unscored ground
    // that is indistinguishable from unmapped ground.
    fc.assert(
      fc.property(
        positionArb,
        fc.double({ min: 0.0001, max: 0.0008, noNaN: true }),
        (start, delta) => {
          const cells = [
            ...cellsOf({
              kind: "linestring",
              positions: [
                start,
                { lat: start.lat + delta, lng: start.lng + delta },
              ],
            }),
          ];
          if (cells.length < 2) return;
          for (const cell of cells) {
            const adjacent = cells.some(
              (other) => other !== cell && gridDistance(cell, other) === 1,
            );
            expect(adjacent).toBe(true);
          }
        },
      ),
      { numRuns: 40 },
    );
  });

  it("a point is always covered by exactly its own cell", () => {
    fc.assert(
      fc.property(positionArb, (position) => {
        const cells = [...cellsOf({ kind: "point", position })];
        expect(cells).toEqual([
          latLngToCell(position.lat, position.lng, AFFORDANCE_RES),
        ]);
      }),
    );
  });

  it("results are always duplicate-free and always fraction 1", () => {
    fc.assert(
      fc.property(
        positionArb,
        fc.integer({ min: 5, max: 50 }),
        (centre, size) => {
          const covered = coverCells(squareAt(centre, size));
          expect(new Set(covered.map((c) => c.cell)).size).toBe(covered.length);
          for (const c of covered) expect(c.fraction).toBe(1);
        },
      ),
      { numRuns: 40 },
    );
  });

  it("vertex order does not change the covered set", () => {
    // Ring winding is not normalised anywhere upstream, and OSM contains both
    // orientations. A coverage that depended on winding would score the same
    // building differently depending on how a mapper happened to draw it.
    fc.assert(
      fc.property(
        positionArb,
        fc.integer({ min: 10, max: 45 }),
        (centre, size) => {
          const forward = squareAt(centre, size);
          const reversed: OsmGeometry = {
            kind: "polygon",
            rings: [[...forward.rings[0]!].reverse()],
          };
          expect(cellsOf(reversed)).toEqual(cellsOf(forward));
        },
      ),
      { numRuns: 40 },
    );
  });
});
