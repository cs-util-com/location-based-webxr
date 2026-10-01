/**
 * Tests for the terrain lab's far field, style C (terrain plan 2026-09-27-0605
 * §4, §5 T2, §9 findings 11 and 12; research 2026-09-27-0600 §6.3).
 *
 * Why this file matters: style C's whole promise is that the terrain seen
 * from far away is the globe's own picture, so the later dive has no seam.
 * That needs the right imagery tiles for a region (the globe's EPSG:4326
 * layout, not the elevation's Mercator one), each pixel sampled at its
 * centre, the grid placed where the shader reads it, and the globe's tone
 * mapping reproduced exactly: a slip in any of them is a colour shift or a
 * half-pixel slide that the eye takes for the imagery. The tone mapping is
 * held to values worked out by hand from three's formula, not from this
 * code.
 */
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  FAR_FIELD,
  GLOBE_SUN,
  farColour,
  farFieldAt,
  farFieldGrid,
  farWeights,
  imageryTiles,
  linearToSrgb,
  neutralToneMap,
  regionBox,
  sampleImagery,
  srgbToLinear,
} from "./terrain-far-field.js";

const close = (a, b, eps, what) =>
  assert.ok(Math.abs(a - b) <= eps, `${what}: ${a} vs ${b}`);

/** The lab's frame: equirectangular about an origin (the Osm `enuFrameAt`). */
const frameAt = (origin) => {
  const mLng = 111_320 * Math.cos((origin.lat * Math.PI) / 180);
  return {
    toLatLng: (p) => ({
      lat: origin.lat + p.y / 111_320,
      lng: origin.lng + p.x / mLng,
    }),
  };
};

// Why (review 2026-10-01, m7): the far field must read the finest level
// the globe commits, or the dive from the globe crosses from 2.4 km
// texels to 4.9 km ones exactly where it meets the terrain. Level 5 (round
// 4, DEC-GL4-3): 64 x 32 tiles of 5.625 degrees, about 2.4 km a pixel
// north-south, near the grid's own 2 km a texel at 256 km.
describe("FAR_FIELD", () => {
  it("reads level 5, the globe's finest committed level", () => {
    assert.equal(FAR_FIELD.level, 5);
    const kmPerPixel =
      (180 / 2 ** FAR_FIELD.level / FAR_FIELD.tileSize) * 111.32;
    assert.ok(kmPerPixel > 2.3 && kmPerPixel < 2.5, `${kmPerPixel}`);
  });
  it("finds the level-5 tile over the Blue Ridge", () => {
    // lng -80: floor(100 / 5.625) = 17; lat 38: floor(52 / 5.625) = 9.
    assert.deepEqual(
      imageryTiles({ west: -80, south: 37, east: -79, north: 38 }, 5),
      [{ z: 5, x: 17, y: 9 }],
    );
  });
});

describe("imageryTiles", () => {
  // Level 4 has 32 x 16 tiles of 11.25°, x from 180° W, y from 90° N.
  it("finds the level-4 tile over the Blue Ridge", () => {
    const tiles = imageryTiles(
      { west: -80, south: 37, east: -79, north: 38 },
      4,
    );
    // lng -80: floor(100 / 11.25) = 8; lat 38: floor(52 / 11.25) = 4.
    assert.deepEqual(tiles, [{ z: 4, x: 8, y: 4 }]);
  });
  it("covers a box across tile edges, north row first", () => {
    const tiles = imageryTiles(
      { west: -79, south: 33.5, east: -78.5, north: 34 },
      4,
    );
    // -78.75 and 33.75 are tile edges at level 4.
    assert.deepEqual(tiles, [
      { z: 4, x: 8, y: 4 },
      { z: 4, x: 9, y: 4 },
      { z: 4, x: 8, y: 5 },
      { z: 4, x: 9, y: 5 },
    ]);
  });
  it("refuses a bad level or an inside-out box", () => {
    assert.throws(() =>
      imageryTiles({ west: 0, south: 0, east: 1, north: 1 }, -1),
    );
    assert.throws(() =>
      imageryTiles({ west: 1, south: 0, east: 0, north: 1 }, 2),
    );
  });
});

describe("regionBox", () => {
  it("bounds the square's corners and widens by the pixel", () => {
    const f = frameAt({ lat: 37.9, lng: -79.2 });
    const box = regionBox(f.toLatLng, 128_000, 0.1);
    close(box.north, 37.9 + 128_000 / 111_320 + 0.1, 1e-9, "north");
    close(box.south, 37.9 - 128_000 / 111_320 - 0.1, 1e-9, "south");
    assert.ok(box.west < -79.2 - 1.4 && box.east > -79.2 + 1.4);
  });
});

/** One level-1 tile (90° square) of a single colour, with one odd pixel. */
function tile(x, y, rgb, odd) {
  const size = 4;
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    data.set([...rgb, 255], i * 4);
  }
  if (odd) data.set([...odd.rgb, 255], 4 * (odd.row * size + odd.col));
  return { z: 1, x, y, width: size, height: size, data };
}

describe("sampleImagery", () => {
  // Level 1: 4 x 2 tiles of 90°; 4 px each, so 22.5° a pixel. Pixel (col,
  // row) of tile (x, y) has its centre at lng -180 + 90x + 22.5(col + 0.5),
  // lat 90 - 90y - 22.5(row + 0.5).
  const tiles = [
    tile(1, 0, [100, 100, 100], { col: 1, row: 2, rgb: [200, 0, 50] }),
    tile(2, 0, [20, 40, 60]),
  ];
  it("returns a pixel's own value at its centre", () => {
    const lng = -180 + 90 + 22.5 * 1.5;
    const lat = 90 - 22.5 * 2.5;
    const v = sampleImagery(tiles, lat, lng);
    assert.deepEqual(
      v.map((c) => Math.round(c * 255)),
      [200, 0, 50],
    );
  });
  it("interpolates across a tile edge", () => {
    // Halfway between tile 1's last column and tile 2's first, row 0.
    const v = sampleImagery(tiles, 90 - 22.5 * 0.5, 0);
    assert.deepEqual(
      v.map((c) => Math.round(c * 255)),
      [60, 70, 80],
    );
  });
  it("is null where a neighbour tile is missing", () => {
    assert.equal(sampleImagery(tiles, 90 - 22.5 * 0.5, 90 + 22.5 * 3.9), null);
    assert.equal(sampleImagery([], 0, 0), null);
  });
});

describe("farFieldGrid and farFieldAt", () => {
  const f = frameAt({ lat: 10, lng: 20 });
  // A sample that encodes the position, so the grid's placement is visible:
  // red from the longitude, green from the latitude.
  const sample = (lat, lng) => [(lng - 19) / 2, (lat - 9) / 2, 0.5];
  const side = 8;
  const halfM = 50_000;
  const grid = farFieldGrid({ side, halfM, toLatLng: f.toLatLng, sample });
  it("places texel (c, r) at its centre, row 0 south", () => {
    const step = (2 * halfM) / side;
    for (const [c, r] of [
      [0, 0],
      [7, 0],
      [3, 5],
    ]) {
      const want = sample(
        ...Object.values(
          f.toLatLng({
            x: -halfM + (c + 0.5) * step,
            y: -halfM + (r + 0.5) * step,
          }),
        ),
      );
      const i = 4 * (r * side + c);
      assert.deepEqual(
        [grid[i], grid[i + 1], grid[i + 2], grid[i + 3]],
        [...want.map((v) => Math.round(v * 255)), 255],
      );
    }
  });
  it("reads back a texel centre exactly, and between them linearly", () => {
    const step = (2 * halfM) / side;
    const x = -halfM + 3.5 * step;
    const y = -halfM + 5.5 * step;
    const i = 4 * (5 * side + 3);
    assert.deepEqual(
      farFieldAt(grid, side, halfM, x, y).map((v) => Math.round(v * 255)),
      [grid[i], grid[i + 1], grid[i + 2]],
    );
    const mid = farFieldAt(grid, side, halfM, x + step / 2, y);
    const j = i + 4;
    close(mid[0] * 255, (grid[i] + grid[j]) / 2, 1e-9, "midway red");
  });
  it("leaves a texel the imagery cannot answer empty", () => {
    const holes = farFieldGrid({
      side: 2,
      halfM,
      toLatLng: f.toLatLng,
      sample: () => null,
    });
    assert.deepEqual([...holes], new Array(16).fill(0));
    assert.equal(farFieldAt(holes, 2, halfM, 0, 0), null);
  });
  it("refuses a side it cannot interpolate", () => {
    assert.throws(() =>
      farFieldGrid({ side: 1, halfM, toLatLng: f.toLatLng, sample }),
    );
  });
});

describe("the tone mapping (three's Neutral, finding 12)", () => {
  it("round-trips the sRGB curves", () => {
    for (const v of [0, 0.002, 0.04, 0.2, 0.5, 0.9, 1]) {
      close(srgbToLinear(linearToSrgb(v)), v, 2e-4, `${v}`);
    }
  });
  // Worked by hand from the formula: below the toe's 0.08 the offset is
  // x - 6.25x², above it 0.04; below 0.76 nothing else happens.
  it("applies the toe and offset below the compression", () => {
    const [r, g, b] = neutralToneMap([0.5, 0.3, 0.05]);
    const offset = 0.05 - 6.25 * 0.05 * 0.05;
    close(r, 0.5 - offset, 1e-12, "r");
    close(g, 0.3 - offset, 1e-12, "g");
    close(b, 0.05 - offset, 1e-12, "b");
    const flat = neutralToneMap([0.4, 0.4, 0.2]);
    [0.36, 0.36, 0.16].forEach((v, i) => close(flat[i], v, 1e-12, `[${i}]`));
  });
  it("compresses a bright peak toward 1 and desaturates it a little", () => {
    const [r, g, b] = neutralToneMap([2, 1, 0.5]);
    // peak 1.96 after the 0.04 offset; d = 0.24.
    const newPeak = 1 - (0.24 * 0.24) / (1.96 + 0.24 - 0.76);
    close(Math.max(r, g, b), newPeak, 1e-9, "the peak is the new peak");
    assert.ok(r < 1 && g < r && b < g);
  });
  // The globe lights its ground with a sun of intensity 5 (DEC-GL4-1; π in
  // phase 1, where Lambert's 1/π made "lit from straight above" exactly
  // the texel). The far field must match the globe it hands over to, so
  // the texel is lit at 5/π: a mid grey comes out LIGHTER, not darker.
  it("lights the texel as the globe does: Lambert at its intensity, straight from above", () => {
    const texel = [0.5, 0.4, 0.2];
    const want = neutralToneMap(
      texel.map((v) => (srgbToLinear(v) * GLOBE_SUN.intensity) / Math.PI),
    ).map((v) => linearToSrgb(Math.max(0, v)));
    farColour(texel).forEach((v, i) => close(v, want[i], 1e-12, `[${i}]`));
    const [grey] = farColour([0.5, 0.5, 0.5]);
    assert.ok(grey > 0.55 && grey < 0.62, `${grey}`);
    assert.deepEqual(farColour([0, 0, 0]), [0, 0, 0]);
  });
  it("scales with the sun's light on the ground (0 at night)", () => {
    assert.deepEqual(farColour([0.5, 0.5, 0.5], 0), [0, 0, 0]);
    const [low] = farColour([0.5, 0.5, 0.5], 0.3);
    const [high] = farColour([0.5, 0.5, 0.5], 1);
    assert.ok(low < high, `${low} ${high}`);
  });
});

describe("farWeights", () => {
  it("is the near style alone when the far field is off", () => {
    assert.deepEqual(farWeights(5e6, { on: false }), { near: 1, relief: 0 });
  });
  // Research §6.3's defaults: the near style from 1500 km down to 300 km.
  it("blends the near style in between high and low", () => {
    assert.equal(farWeights(1_600_000, { on: true }).near, 0);
    assert.equal(farWeights(250_000, { on: true }).near, 1);
    close(farWeights(900_000, { on: true }).near, 0.5, 1e-12, "midway");
  });
  it("fades the far field's relief in from twice high to high", () => {
    assert.equal(farWeights(3_100_000, { on: true }).relief, 0);
    assert.equal(farWeights(1_400_000, { on: true }).relief, 1);
  });
  it("follows the swept altitudes", () => {
    const w = farWeights(1_000_000, { on: true, highKm: 1000, lowKm: 100 });
    assert.deepEqual(w, { near: 0, relief: 1 });
    assert.equal(FAR_FIELD.highKm, 1500);
  });
});
