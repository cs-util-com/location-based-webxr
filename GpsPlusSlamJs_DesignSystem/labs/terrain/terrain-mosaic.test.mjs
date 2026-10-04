/**
 * Tests for the terrain lab's tile set and mosaic (terrain plan 2026-09-27-0605
 * §5 T1 and §9 findings 5 and 15).
 *
 * Why this file matters: the lab turns Web Mercator tiles into one metric
 * grid. Three silent failures are possible, each of which still draws a
 * plausible landscape: a tile missing from the set (a strip of the region
 * reads the edge value), a seam at a tile boundary (a straight line across
 * every ridge, magnified by the slope boost), and a failed tile read as sea
 * level (a crater shaped like the outage). Each has a check that fails on it.
 * The Mercator maths itself is the Osm library's (`toWorldPixel`), injected;
 * these tests pin what this module adds on top.
 */
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  createMosaic,
  mosaicProvider,
  regionTiles,
  sampleMosaic,
  tileRangeFor,
} from "./terrain-mosaic.js";

const TILE = 256;

describe("tileRangeFor", () => {
  // The footprint is widened by one pixel before choosing tiles: a sample
  // just inside a tile's edge interpolates with the NEIGHBOUR's first pixel
  // centre, so that neighbour must be fetched too.
  it("includes the neighbour a boundary sample interpolates with", () => {
    const range = tileRangeFor(
      [
        { x: 256.2, y: 300 },
        { x: 700, y: 400 },
      ],
      TILE,
    );
    assert.deepEqual(range, { x0: 0, x1: 2, y0: 1, y1: 1 });
  });

  it("stays inside one tile when the footprint does", () => {
    const range = tileRangeFor(
      [
        { x: 300, y: 300 },
        { x: 400, y: 400 },
      ],
      TILE,
    );
    assert.deepEqual(range, { x0: 1, x1: 1, y0: 1, y1: 1 });
  });

  it("refuses an empty or non-finite footprint", () => {
    assert.throws(() => tileRangeFor([], TILE), RangeError);
    assert.throws(() => tileRangeFor([{ x: NaN, y: 1 }], TILE), RangeError);
  });
});

describe("regionTiles", () => {
  // The region's corners go through the injected frame and projection; the
  // result is every tile of the range, row by row. A fake projection that
  // maps metres straight to world pixels makes the expectation readable.
  it("lists every tile under the field, row-major", () => {
    const tiles = regionTiles(
      { zoom: 3, extentM: 300 },
      {
        toLatLng: ({ x, y }) => ({ lat: y, lng: x }),
        toWorldPixel: ({ lat, lng }) => ({ x: 512 + lng, y: 512 - lat }),
      },
    );
    // Corners at world pixels 212..812 on both axes, widened by one pixel.
    const expected = [];
    for (let y = 0; y <= 3; y++) {
      for (let x = 0; x <= 3; x++) expected.push(`3/${x}/${y}`);
    }
    assert.deepEqual(
      tiles.map((t) => `${t.z}/${t.x}/${t.y}`),
      expected,
    );
  });
});

/** A synthetic tile whose pixel (c, r) holds `f(worldX, worldY)` at its centre. */
function tile(x, y, f) {
  const samples = new Float32Array(TILE * TILE);
  for (let r = 0; r < TILE; r++) {
    for (let c = 0; c < TILE; c++) {
      samples[r * TILE + c] = f(x * TILE + c + 0.5, y * TILE + r + 0.5);
    }
  }
  return { x, y, size: TILE, samples };
}

describe("createMosaic and sampleMosaic", () => {
  const plane = (wx, wy) => 3 * wx - 2 * wy + 10;
  const range = { x0: 4, x1: 5, y0: 7, y1: 8 };
  const tiles = [];
  for (let y = 7; y <= 8; y++) {
    for (let x = 4; x <= 5; x++) tiles.push(tile(x, y, plane));
  }
  const mosaic = createMosaic(range, tiles, TILE);

  // No seam: bilinear sampling of a plane reproduces the plane exactly,
  // INCLUDING between the last pixel of one tile and the first of the next.
  // A per-tile sampler clamps there, which is the seam this mosaic removes.
  it("reproduces a plane exactly across tile boundaries", () => {
    for (const wx of [1100, 1279.5, 1279.9, 1280, 1280.3, 1400]) {
      for (const wy of [1850, 2047.7, 2048, 2048.4, 2200]) {
        assert.ok(
          Math.abs(sampleMosaic(mosaic, wx, wy) - plane(wx, wy)) < 1e-3,
          `${wx},${wy}`,
        );
      }
    }
  });

  // The plane resampling's anchor: a pixel CENTRE is where its value lives.
  // Off by half a pixel is 240 m at z8, a misregistration that looks like
  // data rather than like arithmetic.
  it("returns a pixel's own value at its centre", () => {
    const t = tiles[3]; // x 5, y 8
    const c = 17;
    const r = 200;
    assert.equal(
      sampleMosaic(mosaic, 5 * TILE + c + 0.5, 8 * TILE + r + 0.5),
      t.samples[r * TILE + c],
    );
  });

  it("reads no data where a tile did not arrive, never 0 m", () => {
    const holed = createMosaic(
      range,
      tiles.filter((t) => !(t.x === 5 && t.y === 7)),
      TILE,
    );
    assert.equal(
      sampleMosaic(holed, 5 * TILE + 100, 7 * TILE + 100),
      undefined,
    );
    // A sample whose bilinear footprint touches the hole is no data too.
    assert.equal(
      sampleMosaic(holed, 5 * TILE + 0.2, 7 * TILE + 100),
      undefined,
    );
    assert.ok(
      Number.isFinite(sampleMosaic(holed, 4 * TILE + 100, 7 * TILE + 100)),
    );
    assert.equal(holed.missingTiles, 1);
  });

  it("reads no data outside the range", () => {
    assert.equal(sampleMosaic(mosaic, 0, 0), undefined);
  });

  it("refuses a tile of the wrong size", () => {
    assert.throws(
      () =>
        createMosaic(
          range,
          [{ x: 4, y: 7, size: 512, samples: new Float32Array(512 * 512) }],
          TILE,
        ),
      /512/,
    );
  });
});

describe("mosaicProvider", () => {
  // The provider is how OsmDemo's `buildHeightfieldData` reads the mosaic:
  // one batched call, `undefined` for no data (which the heightfield counts
  // and fills from the mean, never with 0).
  it("answers a batch through the injected projection", async () => {
    const range = { x0: 0, x1: 0, y0: 0, y1: 0 };
    const mosaic = createMosaic(range, [tile(0, 0, (wx) => wx)], TILE);
    const provider = mosaicProvider(mosaic, (p) => ({ x: p.lng, y: p.lat }));
    const out = await provider.elevationAt([
      { lat: 100, lng: 50.5 },
      { lat: 100, lng: 9999 },
    ]);
    assert.deepEqual(out, [50.5, undefined]);
  });
});
