/**
 * Why this test matters: the tiles of every level must cover the whole
 * globe exactly once. A gap is a hole in the Earth, an overlap a tile
 * fetched twice; both could hide at one level and not another.
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { pyramidTiles, tileBBox4326 } from "./tile-pyramid.js";

describe("the 4326 pyramid at any level", () => {
  it("tiles the globe exactly: areas sum to 360 x 180, every box inside", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 6 }), (z) => {
        let area = 0;
        for (const t of pyramidTiles(z).filter((u) => u.z === z)) {
          const b = tileBBox4326(t.x, t.y, t.z);
          expect(b.west).toBeGreaterThanOrEqual(-180);
          expect(b.east).toBeLessThanOrEqual(180);
          expect(b.south).toBeGreaterThanOrEqual(-90);
          expect(b.north).toBeLessThanOrEqual(90);
          area += (b.east - b.west) * (b.north - b.south);
        }
        expect(area).toBeCloseTo(360 * 180, 6);
      }),
      { numRuns: 7 },
    );
  });

  it("puts a point in exactly one tile of any level", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -179.999, max: 179.999, noNaN: true }),
        fc.double({ min: -89.999, max: 89.999, noNaN: true }),
        fc.integer({ min: 0, max: 5 }),
        (lon, lat, z) => {
          const hits = pyramidTiles(z)
            .filter((t) => t.z === z)
            .filter((t) => {
              const b = tileBBox4326(t.x, t.y, t.z);
              return (
                lon >= b.west && lon < b.east && lat > b.south && lat <= b.north
              );
            });
          expect(hits).toHaveLength(1);
        },
      ),
    );
  });
});
