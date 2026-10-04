/**
 * Why this test matters: the committed imagery pyramid must match the
 * library's EPSG:4326 XYZ layout exactly (two 180-degree tiles at level 0,
 * y = 0 at the north, as `{y}` in the URL makes the library flip). One
 * swapped axis or an off-by-one level puts every continent in the wrong
 * place, and nothing but a look at the globe would notice.
 */

import { describe, expect, it } from "vitest";

import { pyramidTiles, tileBBox4326, wmsBBox } from "./tile-pyramid.js";

describe("tileBBox4326", () => {
  it("splits the world into two 180-degree tiles at level 0", () => {
    expect(tileBBox4326(0, 0, 0)).toEqual({
      west: -180,
      south: -90,
      east: 0,
      north: 90,
    });
    expect(tileBBox4326(1, 0, 0)).toEqual({
      west: 0,
      south: -90,
      east: 180,
      north: 90,
    });
  });

  it("counts rows from the north: y = 0 is the top row", () => {
    expect(tileBBox4326(0, 0, 1)).toEqual({
      west: -180,
      south: 0,
      east: -90,
      north: 90,
    });
    expect(tileBBox4326(3, 1, 1)).toEqual({
      west: 90,
      south: -90,
      east: 180,
      north: 0,
    });
  });

  it("refuses a tile outside its level", () => {
    expect(() => tileBBox4326(2, 0, 0)).toThrow(RangeError);
    expect(() => tileBBox4326(0, 1, 0)).toThrow(RangeError);
    expect(() => tileBBox4326(0, 0, -1)).toThrow(RangeError);
  });
});

describe("wmsBBox", () => {
  // WMS 1.3.0 with EPSG:4326 orders the box latitude first.
  it("orders the box latitude first, as WMS 1.3.0 wants for EPSG:4326", () => {
    expect(wmsBBox(tileBBox4326(3, 1, 1))).toBe("-90,90,0,180");
  });
});

describe("pyramidTiles", () => {
  it("has 2 x 4^z tiles per level", () => {
    const tiles = pyramidTiles(3);
    for (let z = 0; z <= 3; z++) {
      expect(tiles.filter((t) => t.z === z)).toHaveLength(2 * 4 ** z);
    }
    expect(tiles).toHaveLength(2 + 8 + 32 + 128);
  });
});
