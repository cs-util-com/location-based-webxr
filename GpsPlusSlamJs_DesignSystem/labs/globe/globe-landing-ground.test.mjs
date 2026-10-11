/**
 * The landing's ground read (round-4 plan 2026-10-11-0122 DEC-R4-1, §6
 * item 3): the globe's `readLandingGroundM` over the Osm library's
 * `TerrariumProvider`, the pair the globe lab wires, on a synthetic tile.
 *
 * Why this file matters: each module is tested alone (the decoder in the
 * Osm library, the read's timeout and fallbacks in the globe), and what no
 * single test sees is whether they agree: the provider asked at the zoom
 * the read names, the tile at the place's Web Mercator pixel, the Terrarium
 * triple decoded to metres, the bilinear lookup at the right offset. Each
 * slip would still read a plausible ground, off by a tile or 256 m. So
 * this runs the REAL modules (their TypeScript source, through the same
 * two-line resolve hook as the terrain lab's pipeline test) and holds the
 * height to the formula the synthetic tile was written with, computed
 * here from the Mercator formula, not from the library's own function.
 */
import { strict as assert } from "node:assert";
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

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
const { TerrariumProvider } = await import(
  new URL("GpsPlusSlamJs_Osm/src/elevation/terrarium.ts", REPO).href
);
const { LANDING_GROUND, readLandingGroundM } = await import(
  new URL("GpsPlusSlamJs_Globe/src/landing-ground.ts", REPO).href
);

const LUCERNE = { lat: 47.0502, lng: 8.3093 };
const SIZE = 256;

/** The place's continuous Web Mercator pixel at zoom z (the formula). */
function worldPixel({ lat, lng }, z) {
  const s = Math.sin((lat * Math.PI) / 180);
  const scale = 2 ** z * SIZE;
  return {
    x: ((lng + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * scale,
  };
}

/** A synthetic height: 400 m plus 2 m a pixel east and 1 m a pixel south. */
const heightAt = (px, py) => 400 + 2 * px + py + 0.25;

/** The synthetic tile's decoded RGBA (Terrarium: h + 32768 = r 256 + g + b / 256). */
function decoded() {
  const data = new Uint8ClampedArray(SIZE * SIZE * 4);
  for (let py = 0; py < SIZE; py++) {
    for (let px = 0; px < SIZE; px++) {
      const v = heightAt(px, py) + 32768;
      const i = 4 * (py * SIZE + px);
      data[i] = Math.floor(v / 256);
      data[i + 1] = Math.floor(v) % 256;
      data[i + 2] = Math.round((v - Math.floor(v)) * 256);
      data[i + 3] = 255;
    }
  }
  return { width: SIZE, height: SIZE, data };
}

describe("the landing's ground over the Osm library's Terrarium provider", () => {
  it("reads the place's tile at the relief's zoom and the height at its pixel", async () => {
    const asked = [];
    const provider = new TerrariumProvider({
      zoom: LANDING_GROUND.zoom,
      urlTemplate: "https://heights.test/{z}/{x}/{y}.png",
      fetchImpl: async (url) => {
        asked.push(url);
        return new Response(new ArrayBuffer(8));
      },
      decodePng: async () => decoded(),
    });
    const read = await readLandingGroundM(provider, LUCERNE);
    const p = worldPixel(LUCERNE, LANDING_GROUND.zoom);
    const tx = Math.floor(p.x / SIZE);
    const ty = Math.floor(p.y / SIZE);
    assert.deepEqual(asked, [`https://heights.test/12/${tx}/${ty}.png`]);
    // Bilinear over a plane is the plane itself, at the pixel's offset.
    const expected = heightAt(p.x - tx * SIZE, p.y - ty * SIZE);
    assert.equal(read.source, "tile");
    assert.ok(
      Math.abs(read.groundM - expected) < 0.01,
      `read ${read.groundM} m, the formula ${expected} m`,
    );
  });

  it("falls back to the ellipsoid when the tile is missing", async () => {
    const provider = new TerrariumProvider({
      zoom: LANDING_GROUND.zoom,
      fetchImpl: async () => new Response("", { status: 404 }),
      decodePng: async () => decoded(),
    });
    assert.deepEqual(await readLandingGroundM(provider, LUCERNE), {
      groundM: 0,
      source: "fallback",
    });
  });
});
