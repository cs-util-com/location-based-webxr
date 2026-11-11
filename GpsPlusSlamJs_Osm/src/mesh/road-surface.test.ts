import fc from "fast-check";
import { describe, expect, it } from "vitest";

import type { LatLng, OsmFeature } from "../model/osm-feature.js";
import { enuFrameAt } from "./enu.js";
import { roadGroundIndex } from "./road-surface.js";
import { buildRoads, roadWidthM } from "./roads.js";

/**
 * WHY THESE TESTS MATTER. Paint and squares take their height from this
 * index instead of the ground, so it must answer the ground the ribbon was
 * drawn on (its height less its own lift): a wrong lift would sink the paint
 * into the road again, a wrong axis (mesh z is minus north) would answer
 * from the wrong side of the street, and an answer off the road would lift
 * the pavement onto a chord.
 */
const frame = enuFrameAt({ lat: 47.05, lng: 8.3 });
const enu = (x: number, y: number): LatLng => frame.toLatLng({ x, y });

function way(id: number, highway: string, points: [number, number][]) {
  return {
    type: "way",
    id,
    tags: { highway },
    geometry: points.map(([x, y]) => enu(x, y)),
  } as OsmFeature;
}

describe("roadGroundIndex", () => {
  it("answers the ground under a ribbon without its lift, nothing off it", () => {
    const ground = (p: LatLng): number => 3 + 0.1 * frame.toEnu(p).y;
    const ribbons = buildRoads(
      [
        way(1, "primary", [
          [-40, 20],
          [40, 20],
        ]),
      ],
      { frame, groundHeightM: ground },
    );
    expect(ribbons[0]!.liftM).toBeGreaterThan(0);
    const index = roadGroundIndex(ribbons);
    // North 20: the ribbon is there; south 20 is not on it (a sign error on
    // the mesh's z would swap the two).
    expect(index.highestAt({ x: 5, y: 20 })).toBeCloseTo(5, 4);
    expect(index.highestAt({ x: 5, y: -20 })).toBeUndefined();
    expect(index.lowestAt({ x: 100, y: 20 })).toBeUndefined();
  });

  it("takes the highest and the lowest of two ribbons that overlap", () => {
    // Two ways cross on a ground that curves along x: each is a chord of its
    // own end points, so at the crossing they part.
    const ground = (p: LatLng): number => (frame.toEnu(p).x / 10) ** 2;
    const ribbons = buildRoads(
      [
        way(1, "primary", [
          [-50, 0],
          [50, 0],
        ]),
        way(2, "primary", [
          [0, -30],
          [0, 30],
        ]),
      ],
      { frame, groundHeightM: ground },
    );
    const index = roadGroundIndex(ribbons);
    expect(index.highestAt({ x: 0, y: 0 })).toBeCloseTo(25, 3);
    // The north-south way samples at its edges, half a width east and west.
    const half = roadWidthM({ highway: "primary" }) / 2;
    expect(index.lowestAt({ x: 0, y: 0 })).toBeCloseTo((half / 10) ** 2, 3);
  });

  it("skips a ribbon whose lift is not a number", () => {
    const ribbons = buildRoads(
      [
        way(1, "primary", [
          [-40, 0],
          [40, 0],
        ]),
      ],
      {
        frame,
      },
    );
    const index = roadGroundIndex([{ ...ribbons[0]!, liftM: Number.NaN }]);
    expect(index.highestAt({ x: 0, y: 0 })).toBeUndefined();
  });

  // On a PLANE ground every chord is exact, so anywhere on a road the index
  // must answer the plane itself, whatever the way's shape and class.
  it("answers the ground itself anywhere on a road over a plane", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.tuple(
            fc.double({ min: -60, max: 60, noNaN: true }),
            fc.double({ min: -60, max: 60, noNaN: true }),
          ),
          { minLength: 2, maxLength: 6 },
        ),
        fc.constantFrom("footway", "service", "residential", "primary"),
        fc.double({ min: -0.3, max: 0.3, noNaN: true }),
        fc.double({ min: -0.3, max: 0.3, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (points, highway, gx, gy, along) => {
          const plane = (x: number, y: number): number => 7 + gx * x + gy * y;
          const ground = (p: LatLng): number => {
            const e = frame.toEnu(p);
            return plane(e.x, e.y);
          };
          const ribbons = buildRoads([way(1, highway, points)], {
            frame,
            groundHeightM: ground,
          });
          const index = roadGroundIndex(ribbons);
          // A point on the way's centre line, on its first segment.
          const [a, b] = [points[0]!, points[1]!];
          if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 1e-3) return;
          const p = {
            x: a[0] + along * (b[0] - a[0]),
            y: a[1] + along * (b[1] - a[1]),
          };
          const h = index.highestAt(p);
          expect(h).toBeDefined();
          // Float32 positions: a few hundredths of a millimetre.
          expect(Math.abs(h! - plane(p.x, p.y))).toBeLessThan(1e-4);
          expect(index.lowestAt(p)).toBeCloseTo(h!, 3);
        },
      ),
      { numRuns: 200 },
    );
  });
});
