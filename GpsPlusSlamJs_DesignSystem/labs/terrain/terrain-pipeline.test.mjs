/**
 * Tests for the terrain lab's data chain, lon/lat to texel (terrain plan
 * 2026-09-27-0605 §4 "Data", §9 finding 5; the T0/T1 review's findings 4
 * and 6).
 *
 * Why this file matters: the chain crosses four modules from three packages
 * (the Osm library's Mercator maths and ENU frame, the lab's mosaic,
 * OsmDemo's heightfield) and each is tested alone. What no single test
 * sees is whether they agree with each other: a row order flipped between
 * the heightfield and the textures, a half-pixel offset, a grid whose side
 * differs from the one the page allocates. Each would still draw a
 * plausible landscape in the wrong place. So this runs the REAL modules
 * (their TypeScript source, loaded through a two-line resolve hook) and
 * holds the texel values to the Web Mercator formula written out here, not
 * to the library's own function.
 */
import { strict as assert } from "node:assert";
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { regionTiles } from "./terrain-mosaic.js";
import { fieldSpec, TERRAIN_PLACES } from "./terrain-params.js";
import { reliefField } from "./terrain-pipeline.js";

// The served packages import their siblings as `./x.js` (the browser gets
// the stripped `.ts` through the dev server's routes); Node needs the `.ts`.
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.endsWith(".js") && context.parentURL?.endsWith(".ts")) {
      const ts = new URL(specifier.replace(/\.js$/, ".ts"), context.parentURL);
      if (existsSync(fileURLToPath(ts))) return next(ts.href, context);
    }
    return next(specifier, context);
  },
});

const REPO = new URL("../../../", import.meta.url);
const { toWorldPixel } = await import(
  new URL("GpsPlusSlamJs_Osm/src/elevation/terrarium.ts", REPO).href
);
const { enuFrameAt } = await import(
  new URL("GpsPlusSlamJs_Osm/src/mesh/enu.ts", REPO).href
);
const { buildHeightfieldData } = await import(
  new URL("GpsPlusSlamJs_OsmDemo/src/heightfield.ts", REPO).href
);
const { terrainTextureFrom } = await import(
  new URL("GpsPlusSlamJs_OsmDemo/src/terrain-texture.ts", REPO).href
);
const DEPS = {
  toWorldPixel,
  enuFrameAt,
  buildHeightfieldData,
  terrainTextureFrom,
};

const TILE = 256;
const SPEC = fieldSpec(TERRAIN_PLACES.appalachians);
const RANGE = { x0: 70, x1: 72, y0: 97, y1: 99 };

/** Web Mercator, written out (EPSG:3857 world pixels at zoom z, 256 px tiles). */
function mercatorPixel(lat, lng, z) {
  const scale = 2 ** z * TILE;
  const s = Math.sin((lat * Math.PI) / 180);
  return {
    x: ((lng + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * scale,
  };
}

/**
 * The synthetic terrain: a plane in world pixels, different along each axis,
 * so a swapped or mirrored axis cannot pass. Bilinear sampling reproduces a
 * plane exactly, so the only error left is float32 storage.
 */
const plane = (wx, wy) => 900 + 0.8 * (wx - 18_200) - 0.3 * (wy - 25_300);

/** Decoded tiles (the library's `ElevationTile` shape) holding the plane. */
function planeTiles(skip = () => false) {
  const tiles = [];
  for (let y = RANGE.y0; y <= RANGE.y1; y++) {
    for (let x = RANGE.x0; x <= RANGE.x1; x++) {
      if (skip(x, y)) continue;
      const samples = new Float32Array(TILE * TILE);
      for (let r = 0; r < TILE; r++) {
        for (let c = 0; c < TILE; c++) {
          samples[r * TILE + c] = plane(x * TILE + c + 0.5, y * TILE + r + 0.5);
        }
      }
      tiles.push({ z: 8, x, y, size: TILE, samples });
    }
  }
  return tiles;
}

describe("reliefField: lon/lat to texel", () => {
  it("puts the Mercator plane's value at every post's texel, south row first", async () => {
    const out = await reliefField({
      decoded: planeTiles(),
      range: RANGE,
      spec: SPEC,
      deps: DEPS,
    });
    assert.equal(out.side, SPEC.side);
    assert.equal(out.height.length, SPEC.side * SPEC.side);
    const frame = enuFrameAt(SPEC.centre);
    const last = SPEC.side - 1;
    // Corners, edges' middles and the centre: row 0 is the SOUTH edge.
    for (const [col, row] of [
      [0, 0],
      [last, 0],
      [0, last],
      [last, last],
      [last / 2, 0],
      [0, last / 2],
      [last / 2, last / 2],
      [17, 400],
    ]) {
      const enu = {
        x: -SPEC.extentM + col * SPEC.spacingM,
        y: -SPEC.extentM + row * SPEC.spacingM,
      };
      const { lat, lng } = frame.toLatLng(enu);
      const w = mercatorPixel(lat, lng, SPEC.zoom);
      const texel = out.height[row * SPEC.side + col] + out.datum;
      assert.ok(
        Math.abs(texel - plane(w.x, w.y)) < 0.01,
        `post ${col},${row}: ${texel} vs ${plane(w.x, w.y)}`,
      );
      assert.equal(out.valid[row * SPEC.side + col], 1);
    }
    // The datum is the plane at the region's centre.
    const c = mercatorPixel(SPEC.centre.lat, SPEC.centre.lng, SPEC.zoom);
    assert.ok(Math.abs(out.datum - plane(c.x, c.y)) < 0.01, `${out.datum}`);
  });

  // A missing tile is no data (0 in `valid`), never 0 m: the region's
  // south-east tile covers the south-east corner post.
  it("marks the posts of a missing tile invalid", async () => {
    const out = await reliefField({
      decoded: planeTiles((x, y) => x === 72 && y === 99),
      range: RANGE,
      spec: SPEC,
      deps: DEPS,
    });
    assert.equal(out.missingTiles, 1);
    assert.equal(out.valid[0 * SPEC.side + (SPEC.side - 1)], 0);
    assert.equal(out.valid[(SPEC.side - 1) * SPEC.side + 0], 1);
  });

  // Review finding 4: the page allocates its textures from `spec.side`; a
  // heightfield of another side would be read with the wrong stride.
  it("refuses a heightfield whose side is not the spec's", async () => {
    const fake = {
      ...DEPS,
      buildHeightfieldData: async (provider, options) => ({
        ...(await buildHeightfieldData(provider, options)),
        side: SPEC.side - 1,
      }),
    };
    await assert.rejects(
      reliefField({
        decoded: planeTiles(),
        range: RANGE,
        spec: SPEC,
        deps: fake,
      }),
      /side/,
    );
  });

  it("returns an all-invalid field when no tile arrived", async () => {
    const out = await reliefField({
      decoded: [],
      range: RANGE,
      spec: SPEC,
      deps: DEPS,
    });
    assert.equal(out.hasData, false);
    assert.equal(out.height.length, SPEC.side * SPEC.side);
    assert.ok(out.valid.every((v) => v === 0));
  });
});

// WHY (plan §9 finding 6, DEC-TR-8): every place's committed fixture set is
// exactly the tiles the lab asks for through the REAL projection and frame,
// so the smoke serves each place without a network request, and a moved
// centre that needs a tenth tile fails here, not as a hatch in the browser.
describe("each place's tile set", () => {
  const expected = {
    appalachians: { x: [70, 72], y: [97, 99] },
    alps: { x: [133, 135], y: [89, 91] },
    germany: { x: [133, 135], y: [81, 83] },
  };
  for (const [id, range] of Object.entries(expected)) {
    it(`${id} needs exactly its 3 x 3 z8 tiles`, () => {
      const place = TERRAIN_PLACES[id];
      const spec = fieldSpec(place);
      const frame = enuFrameAt(place.centre);
      const tiles = regionTiles(spec, {
        toLatLng: (p) => frame.toLatLng(p),
        toWorldPixel,
      });
      const want = [];
      for (let y = range.y[0]; y <= range.y[1]; y++) {
        for (let x = range.x[0]; x <= range.x[1]; x++) want.push(`8/${x}/${y}`);
      }
      assert.deepEqual(
        tiles.map((t) => `${t.z}/${t.x}/${t.y}`),
        want,
      );
    });
  }
  it("covers every place the lab has", () => {
    assert.deepEqual(
      Object.keys(expected).sort(),
      Object.keys(TERRAIN_PLACES).sort(),
    );
  });
});
