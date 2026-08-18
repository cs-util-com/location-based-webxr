/**
 * Terrarium decoding, tile arithmetic and the provider.
 *
 * WHY THESE TESTS MATTER. Elevation's failure mode is not a crash — it is a
 * plausible number. A sign error in the +32,768 offset, a swapped x/y in the
 * Mercator maths, or a nearest-neighbour read where bilinear was intended all
 * produce terrain that looks like terrain and is wrong. So every test here
 * pins an EXACT value derived from the published encoding, not a tolerance.
 *
 * No image codec is involved: the decoder is injected, so these tests construct
 * RGBA bytes directly and the decode maths is checked byte-exactly. That is the
 * main reason the decoder is a parameter rather than a browser API call.
 */

import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_TERRARIUM_ZOOM,
  MAPTERHORN_URL_TEMPLATE,
  TerrariumProvider,
  browserPngDecoder,
  decodeTerrarium,
  sampleTile,
  toElevationTile,
  toTilePixel,
  toWorldPixel,
  fromWorldPixel,
} from "./terrarium.js";
import type { DecodedImage } from "./terrarium.js";

describe("the Terrarium encoding", () => {
  it("decodes the documented formula exactly", () => {
    // elevation = (R * 256 + G + B / 256) - 32768
    expect(decodeTerrarium(128, 0, 0)).toBe(0);
    expect(decodeTerrarium(128, 100, 0)).toBe(100);
    expect(decodeTerrarium(128, 0, 128)).toBe(0.5);
  });

  it("represents below-sea-level ground as a NEGATIVE number, not an error", () => {
    // The Dead Sea shore is ~-430 m and Terrarium encodes it normally. A
    // provider that treated "below the offset" as invalid would blank real
    // places — and the offset exists precisely so this is representable.
    expect(decodeTerrarium(126, 82, 0)).toBe(-430);
  });

  it("is exactly invertible at the extremes the encoding allows", () => {
    expect(decodeTerrarium(0, 0, 0)).toBe(-32768);
    expect(decodeTerrarium(255, 255, 0)).toBe(32767);
  });
});

describe("Web Mercator tile arithmetic", () => {
  it("puts 0°,0° at the centre of the world at every zoom", () => {
    for (const z of [0, 1, 10, 13]) {
      const t = toTilePixel({ lat: 0, lng: 0 }, z);
      const half = 2 ** z / 2;
      expect(t.x).toBe(Math.floor(half));
      expect(t.y).toBe(Math.floor(half));
    }
  });

  it("increases x eastward and y southward", () => {
    // Sign errors here are the classic way to render terrain from the wrong
    // hemisphere while everything still "works".
    const west = toTilePixel({ lat: 50, lng: 6 }, 13);
    const east = toTilePixel({ lat: 50, lng: 8 }, 13);
    const north = toTilePixel({ lat: 52, lng: 7 }, 13);
    const south = toTilePixel({ lat: 48, lng: 7 }, 13);

    expect(east.x).toBeGreaterThan(west.x);
    expect(south.y).toBeGreaterThan(north.y);
  });

  it("clamps beyond the Mercator limit instead of emitting Infinity", () => {
    // Mercator diverges at the poles. Emitting NaN tile indices would surface
    // as a failed fetch with no visible cause, which is the worst place to
    // discover a projection limit.
    const pole = toTilePixel({ lat: 89.9, lng: 0 }, 13);
    expect(Number.isFinite(pole.y)).toBe(true);
    expect(Number.isFinite(pole.py)).toBe(true);
  });

  it("wraps longitude rather than running off the grid", () => {
    const wrapped = toTilePixel({ lat: 50, lng: 190 }, 13);
    const equivalent = toTilePixel({ lat: 50, lng: -170 }, 13);
    expect(wrapped.x).toBe(equivalent.x);
  });

  it("defaults to z=13, the zoom that fits a res-7 tile in a 2x2 block", () => {
    // Not z=14: at 50.8°N a z=14 tile spans ~1.55 km against a 2.81 km res-7
    // hexagon, so covering one fetch tile takes NINE terrain requests — the
    // exact cost the res-8 -> res-7 move was made to avoid.
    expect(DEFAULT_TERRARIUM_ZOOM).toBe(13);
  });
});

/** A 2×2 image whose four pixels decode to 0, 100, 200, 300. */
function tinyImage(): DecodedImage {
  const values = [0, 100, 200, 300];
  const data = new Uint8ClampedArray(2 * 2 * 4);
  values.forEach((metres, i) => {
    const raw = metres + 32768;
    data[i * 4] = Math.floor(raw / 256);
    data[i * 4 + 1] = raw % 256;
    data[i * 4 + 2] = 0;
    data[i * 4 + 3] = 255;
  });
  return { width: 2, height: 2, data };
}

describe("sampling a decoded tile", () => {
  const tile = toElevationTile(tinyImage(), 13, 1, 2);

  it("returns the exact sample at pixel centres", () => {
    expect(sampleTile(tile, 0, 0)).toBe(0);
    expect(sampleTile(tile, 1, 0)).toBe(100);
    expect(sampleTile(tile, 0, 1)).toBe(200);
    expect(sampleTile(tile, 1, 1)).toBe(300);
  });

  it("interpolates BILINEARLY between them", () => {
    // Halfway between 0 and 100 horizontally; halfway between that row and the
    // 200/300 row vertically. Nearest-neighbour would give 0 or 300 here, and
    // at ~12 m/pixel that is a visible staircase in an AR overlay.
    expect(sampleTile(tile, 0.5, 0)).toBe(50);
    expect(sampleTile(tile, 0, 0.5)).toBe(100);
    expect(sampleTile(tile, 0.5, 0.5)).toBe(150);
  });

  it("clamps at the edge rather than wrapping", () => {
    // The neighbouring tile is a separate fetch. Clamping is wrong by at most
    // half a pixel; wrapping would be wrong by half the planet.
    expect(sampleTile(tile, 1.9, 1.9)).toBe(300);
    expect(sampleTile(tile, -5, -5)).toBe(0);
  });

  it("rejects a non-square tile instead of reading past the end", () => {
    const oblong: DecodedImage = {
      width: 2,
      height: 3,
      data: new Uint8ClampedArray(2 * 3 * 4),
    };
    expect(() => toElevationTile(oblong, 13, 0, 0)).toThrow(/square/);
  });
});

/**
 * A size×size image split into four quadrants of constant elevation.
 *
 * Exists to make tile-size bugs visible: on a 512-px tile every sample the
 * provider takes must land in the quadrant the position actually falls in, so
 * a coordinate computed for the wrong tile size returns a DIFFERENT quadrant's
 * value rather than a subtly-shifted interpolation.
 */
function quadrantImage(
  size: number,
  [tl, tr, bl, br]: readonly [number, number, number, number],
): DecodedImage {
  const data = new Uint8ClampedArray(size * size * 4);
  const half = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const metres = y < half ? (x < half ? tl : tr) : x < half ? bl : br;
      const raw = metres + 32768;
      const o = (y * size + x) * 4;
      data[o] = Math.floor(raw / 256);
      data[o + 1] = raw % 256;
      data[o + 2] = 0;
      data[o + 3] = 255;
    }
  }
  return { width: size, height: size, data };
}

describe("TerrariumProvider with non-256 tile sizes", () => {
  /**
   * WHY THIS TEST MATTERS. Tile INDICES are size-invariant (worldPixel scales
   * with 2^z · tileSize, so worldX / tileSize is the same for any size), but
   * the WITHIN-TILE pixel offset is not: it scales with the tile's actual
   * pixel width. A provider that computes the offset for 256-px tiles and
   * samples a 512-px tile with it reads only the top-left quadrant — every
   * elevation displaced toward the tile's origin, silently, as plausible
   * terrain. Some terrarium-encoded services serve 512-px tiles, so this is a
   * real configuration, not a hypothetical.
   */
  it("samples a 512-px tile at the position's true within-tile fraction", async () => {
    const tileX = 4302;
    const tileY = 2807;
    // Within-tile fraction 0.75/0.75 → the BOTTOM-RIGHT quadrant. The
    // tile-size bug would sample at pixel (192, 192) of the 512 tile, which is
    // the top-left quadrant.
    const position = fromWorldPixel(
      { x: (tileX + 0.75) * 256, y: (tileY + 0.75) * 256 },
      13,
    );

    const fetchImpl = vi.fn(() =>
      Promise.resolve(new Response(new ArrayBuffer(8), { status: 200 })),
    ) as unknown as typeof fetch;
    const provider = new TerrariumProvider({
      decodePng: () =>
        Promise.resolve(quadrantImage(512, [100, 200, 300, 400])),
      fetchImpl,
      zoom: 13,
    });

    const out = await provider.elevationAt([position]);
    expect(out).toEqual([400]);
  });

  /**
   * WHY THIS TEST MATTERS. Mapterhorn is the ready-made 512-px terrarium
   * service, so this pins the whole configuration end-to-end: the URL template
   * expands to the tile actually under the position, and the 512-px tile is
   * sampled at the position's true within-tile fraction — the exact pairing
   * the tile-size rescale above exists for.
   */
  it("requests the Mapterhorn URL and samples its 512-px tile correctly", async () => {
    const tileX = 4302;
    const tileY = 2807;
    const position = fromWorldPixel(
      { x: (tileX + 0.75) * 256, y: (tileY + 0.75) * 256 },
      13,
    );

    const fetchImpl = vi.fn(() =>
      Promise.resolve(new Response(new ArrayBuffer(8), { status: 200 })),
    ) as unknown as typeof fetch;
    const provider = new TerrariumProvider({
      decodePng: () => Promise.resolve(quadrantImage(512, [10, 20, 30, 40])),
      fetchImpl,
      zoom: 13,
      urlTemplate: MAPTERHORN_URL_TEMPLATE,
    });

    const out = await provider.elevationAt([position]);
    expect(out).toEqual([40]);
    expect(fetchImpl).toHaveBeenCalledWith(
      `https://tiles.mapterhorn.com/13/${tileX}/${tileY}.webp`,
      expect.anything(),
    );
  });
});

describe("TerrariumProvider", () => {
  const decodePng = vi.fn(() => Promise.resolve(tinyImage()));

  function providerWith(fetchImpl: typeof fetch) {
    return new TerrariumProvider({
      decodePng,
      fetchImpl,
      zoom: 13,
    });
  }

  const okFetch = () =>
    vi.fn(() =>
      Promise.resolve(new Response(new ArrayBuffer(8), { status: 200 })),
    ) as unknown as typeof fetch;

  it("fetches each tile ONCE however many positions land in it", async () => {
    const fetchImpl = okFetch();
    const provider = providerWith(fetchImpl);

    // A working set spans one or two terrain tiles. Resolving per position
    // would issue hundreds of identical requests against donated open data —
    // the same "per area, not per point" rule the raster approach exists for.
    const near = Array.from({ length: 50 }, (_, i) => ({
      lat: 50.94 + i * 1e-6,
      lng: 6.95 + i * 1e-6,
    }));
    const out = await provider.elevationAt(near);

    expect(out).toHaveLength(50);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("serves a second call from the decoded cache", async () => {
    const fetchImpl = okFetch();
    const provider = providerWith(fetchImpl);
    const at = [{ lat: 50.94, lng: 6.95 }];

    await provider.elevationAt(at);
    await provider.elevationAt(at);

    // Decode once, sample for free thereafter — the property that makes
    // elevation at res 13 possible at all.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(provider.stats.cacheHits).toBe(1);
  });

  it("returns undefined, not 0, when a tile is missing", async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(new Response("", { status: 404 })),
    ) as unknown as typeof fetch;
    const provider = providerWith(fetchImpl);

    // Zero is a real elevation. A provider that returns it on failure produces
    // a confident wrong answer instead of an absence the caller can branch on.
    const out = await provider.elevationAt([{ lat: 50.94, lng: 6.95 }]);
    expect(out).toEqual([undefined]);
  });

  it("degrades on a decode failure rather than failing the batch", async () => {
    const fetchImpl = okFetch();
    const provider = new TerrariumProvider({
      decodePng: () => Promise.reject(new Error("corrupt png")),
      fetchImpl,
    });

    const out = await provider.elevationAt([{ lat: 50.94, lng: 6.95 }]);
    expect(out).toEqual([undefined]);
    expect(provider.stats.decodeFailures).toBe(1);
  });

  it("propagates an abort instead of degrading", async () => {
    // A caller that left the area is not asking for a degraded answer; it is
    // asking for no answer. Swallowing the abort would keep work alive after
    // the reason for it is gone.
    const abort = Object.assign(new Error("aborted"), { name: "AbortError" });
    const fetchImpl = vi.fn(() =>
      Promise.reject(abort),
    ) as unknown as typeof fetch;
    const provider = providerWith(fetchImpl);

    await expect(
      provider.elevationAt([{ lat: 50.94, lng: 6.95 }]),
    ).rejects.toThrow("aborted");
  });
});

describe("the browser PNG decoder", () => {
  /**
   * WHY THIS SUITE EXISTS, and why it asserts a CALL rather than a value.
   *
   * `decodeTerrarium` treats R/G/B as an exact 24-bit fixed-point number — the
   * module says so, and every other test here pins exact values because of it.
   * But `createImageBitmap` + `drawImage` + `getImageData` is *allowed* to
   * colour-manage on the way through: a `gAMA`, `sRGB` or `iCCP` chunk in the
   * PNG lets the user agent rewrite the triple, and alpha premultiplication can
   * rewrite it again. Both default to "the UA may".
   *
   * A one-step shift in R is **256 metres** of elevation, delivered as a smooth
   * plausible surface — precisely the "looks like a fusion bug" failure this
   * module is organised around, and the reason the opt-outs are not optional.
   *
   * The corruption itself cannot be reproduced here: it needs a real codec and a
   * real colour-managed compositor, and every other test in this file injects a
   * synthetic decoder specifically to avoid one. So what is pinned instead is
   * that the decoder ASKS for the opt-outs — which is the part a future edit
   * could silently drop, with no visible symptom until someone compares a
   * rendered city against a survey.
   */
  const stubCanvas = (): {
    bitmapOptions: () => ImageBitmapOptions | undefined;
    contextOptions: () => unknown;
  } => {
    let bitmapOptions: ImageBitmapOptions | undefined;
    let contextOptions: unknown;

    vi.stubGlobal(
      "createImageBitmap",
      (_blob: unknown, options?: ImageBitmapOptions) => {
        bitmapOptions = options;
        return Promise.resolve({ width: 2, height: 1, close: () => {} });
      },
    );
    vi.stubGlobal(
      "OffscreenCanvas",
      class {
        constructor(
          readonly width: number,
          readonly height: number,
        ) {}
        getContext(_id: string, options?: unknown) {
          contextOptions = options;
          return {
            drawImage: () => {},
            getImageData: (_x: number, _y: number, w: number, h: number) => ({
              width: w,
              height: h,
              data: new Uint8ClampedArray(w * h * 4),
            }),
          };
        }
      },
    );

    return {
      bitmapOptions: () => bitmapOptions,
      contextOptions: () => contextOptions,
    };
  };

  it("opts out of colour management and alpha premultiplication", async () => {
    const stub = stubCanvas();
    await browserPngDecoder()(new ArrayBuffer(8));
    expect(stub.bitmapOptions()).toMatchObject({
      colorSpaceConversion: "none",
      premultiplyAlpha: "none",
    });
    vi.unstubAllGlobals();
  });

  it("asks for a read-optimised context, since it reads every pixel once", async () => {
    // The canvas is never composited or animated — it exists solely to get the
    // bytes back out — so a GPU-backed surface is the wrong trade.
    const stub = stubCanvas();
    await browserPngDecoder()(new ArrayBuffer(8));
    expect(stub.contextOptions()).toMatchObject({ willReadFrequently: true });
    vi.unstubAllGlobals();
  });

  it("names the missing API rather than throwing something opaque", async () => {
    // A Node caller must supply its own decoder, and the error has to say so.
    vi.stubGlobal("createImageBitmap", undefined);
    await expect(browserPngDecoder()(new ArrayBuffer(8))).rejects.toThrow(
      /createImageBitmap/,
    );
    vi.unstubAllGlobals();
  });
});

describe("toWorldPixel / fromWorldPixel", () => {
  /**
   * WHY THESE TESTS MATTER. `toWorldPixel` is the lattice the demo's terrain cache
   * is indexed on, and `fromWorldPixel` is how it turns a lattice index back into
   * the lat/lng an `ElevationProvider` wants. If the two are not exact inverses the
   * lattice drifts off the DEM's own pixel centres, which silently reintroduces the
   * resampling that indexing in pixel space exists to avoid — and the symptom would
   * be terrain that is subtly smoothed, which looks like terrain.
   */
  it("round-trips a position through pixel space", () => {
    const positions = [
      { lat: 50.9413, lng: 6.9583 },
      { lat: 0, lng: 0 },
      { lat: -33.8688, lng: 151.2093 },
      { lat: 64.1466, lng: -21.9426 },
    ];
    for (const position of positions) {
      const pixel = toWorldPixel(position, 13);
      const back = fromWorldPixel(pixel, 13);
      // Sub-micro-degree: ~0.1 mm, i.e. exact for anything this is used for.
      expect(back.lat).toBeCloseTo(position.lat, 9);
      expect(back.lng).toBeCloseTo(position.lng, 9);
    }
  });

  it("agrees with toTilePixel, which is now derived from it", () => {
    // `toTilePixel` was rewritten in terms of `toWorldPixel`; this pins that the
    // refactor changed nothing. Splitting a floor out of a formula is exactly the
    // kind of edit that shifts a boundary by one pixel.
    const position = { lat: 50.9413, lng: 6.9583 };
    const world = toWorldPixel(position, 13);
    const tile = toTilePixel(position, 13);
    expect(tile.x).toBe(Math.floor(world.x / 256));
    expect(tile.y).toBe(Math.floor(world.y / 256));
    expect(tile.px).toBeCloseTo(world.x - tile.x * 256, 9);
    expect(tile.py).toBeCloseTo(world.y - tile.y * 256, 9);
  });

  it("is monotonic in both axes, which is what makes it usable as a lattice", () => {
    // A lattice index that is not monotonic in latitude would interleave posts
    // from different places, and bilinear interpolation over it would be
    // meaningless rather than merely wrong.
    const a = toWorldPixel({ lat: 50.9, lng: 6.9 }, 13);
    const b = toWorldPixel({ lat: 50.9, lng: 7.0 }, 13);
    const c = toWorldPixel({ lat: 51.0, lng: 6.9 }, 13);
    expect(b.x).toBeGreaterThan(a.x);
    // Mercator y grows SOUTHWARD, so a higher latitude is a smaller y.
    expect(c.y).toBeLessThan(a.y);
  });

  it("clamps beyond the Mercator limit rather than emitting Infinity", () => {
    const north = toWorldPixel({ lat: 89.9, lng: 0 }, 13);
    expect(Number.isFinite(north.y)).toBe(true);
    expect(north.y).toBeGreaterThanOrEqual(0);
  });
});
