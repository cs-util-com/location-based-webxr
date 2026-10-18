/**
 * The relief's fallback where its source has no tile (tour editor plan
 * 2026-10-17-1816 §13, G1 step 2; G0 spikes, "Coverage"; G1 review M2).
 *
 * Why this test matters: Mapterhorn's fine zooms (13 and finer) exist only
 * where a national model does, and its deep-ocean tiles exist at no zoom
 * finer than about z5; elsewhere it answers 404, and the library neither
 * checks the status nor knows what else to draw, so the tile failed to
 * decode. The fallback draws the same source's nearest ancestor, cropped
 * to the tile and upsampled: one pyramid, so no step where the level of
 * detail changes (a first version asked AWS for the same tile, which G0
 * measured +5 to +12 m off Mapterhorn in towns). The crop is done on
 * DECODED heights: interpolating the encoded bytes would mix a height's
 * high and low bytes into nonsense (a step of 1 in red is 256 m).
 */
import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";

import {
  RELIEF_FALLBACK,
  decodeTerrariumM,
  encodeTerrarium,
  installReliefFallback,
  resampleTerrarium,
} from "./globe-relief-fallback.js";

/** A square RGBA tile of `size` px whose heights are `h(x, y)` at pixel centres. */
function tile(size: number, h: (x: number, y: number) => number) {
  const out = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++)
      encodeTerrarium(h(x, y), out, 4 * (y * size + x));
  }
  return out;
}
const heightAt = (
  rgba: ArrayLike<number>,
  size: number,
  x: number,
  y: number,
) => {
  const i = 4 * (y * size + x);
  return decodeTerrariumM(rgba[i]!, rgba[i + 1]!, rgba[i + 2]!);
};

describe("the Terrarium encoding", () => {
  // Why: the resampled heights are written back as Terrarium for the
  // library to decode as usual; a round trip must keep them to the
  // encoding's own step (1/256 m).
  it("round-trips a height to within half a step", () => {
    fc.assert(
      fc.property(fc.double({ min: -11_000, max: 9_000, noNaN: true }), (h) => {
        const px = new Uint8ClampedArray(4);
        encodeTerrarium(h, px, 0);
        expect(
          Math.abs(decodeTerrariumM(px[0]!, px[1]!, px[2]!) - h),
        ).toBeLessThanOrEqual(1 / 512 + 1e-9);
        expect(px[3]).toBe(255);
      }),
    );
  });

  it("decodes the library's formula", () => {
    expect(decodeTerrariumM(128, 0, 0)).toBe(0);
    expect(decodeTerrariumM(128, 1, 128)).toBe(1.5);
    expect(decodeTerrariumM(0, 0, 0)).toBe(-32768);
  });
});

describe("resampleTerrarium", () => {
  it("keeps the bytes at the same size", () => {
    const src = tile(4, (x, y) => x * 10 + y);
    expect(resampleTerrarium(src, 4, 4)).toEqual(src);
  });

  it("keeps a flat tile flat", () => {
    const out = resampleTerrarium(
      tile(2, () => 512.25),
      2,
      8,
    );
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) expect(heightAt(out, 8, x, y)).toBe(512.25);
    }
  });

  // Why: bilinear on decoded heights reproduces a plane exactly between
  // the source's pixel centres; interpolating encoded bytes would not (a
  // carry from green into red is a 256 m jump). The plane crosses a red
  // byte boundary (heights around 0 m, 32,768 encoded) on purpose.
  it("follows a plane between the source's pixel centres, across a byte carry", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -3, max: 3, noNaN: true }),
        fc.double({ min: -3, max: 3, noNaN: true }),
        fc.double({ min: -2, max: 2, noNaN: true }),
        (a, b, c) => {
          const src = 8;
          const dst = 16;
          const plane = (x: number, y: number) => a * x + b * y + c;
          const out = resampleTerrarium(tile(src, plane), src, dst);
          // Destination centres inside the source centres' span.
          for (let y = 1; y < dst - 1; y++) {
            for (let x = 1; x < dst - 1; x++) {
              const sx = ((x + 0.5) * src) / dst - 0.5;
              const sy = ((y + 0.5) * src) / dst - 0.5;
              expect(
                Math.abs(heightAt(out, dst, x, y) - plane(sx, sy)),
              ).toBeLessThanOrEqual(1 / 128);
            }
          }
        },
      ),
    );
  });

  // Why (M2): a tile drawn from its ancestor `depth` levels up is the
  // ancestor's quarter (or sixteenth...) at column `col`, row `row` (north
  // first, as the XYZ tiling counts), sampled at the tile's own pixel
  // centres. Pinned by hand: a 4 px ancestor whose height is 10 x column
  // + row, its north-east quarter (col 1, row 0) at 4 px. The centre of
  // the child's pixel 0 lies at ancestor pixel x (1 + 0.5/4) / 2 x 4 - 0.5
  // = 1.75 and y (0 + 0.5/4) / 2 x 4 - 0.5 = -0.25, clamped to 0.
  it("crops an ancestor's quarter at the tile's own pixel centres", () => {
    const out = resampleTerrarium(
      tile(4, (x, y) => 10 * x + y),
      4,
      4,
      { depth: 1, col: 1, row: 0 },
    );
    expect(heightAt(out, 4, 0, 0)).toBeCloseTo(17.5, 2);
    expect(heightAt(out, 4, 3, 0)).toBeCloseTo(30, 2); // 3.25, clamped to 3
    expect(heightAt(out, 4, 0, 3)).toBeCloseTo(17.5 + 1.25, 2);
  });

  // Why (M2): the children of an ancestor, cropped and upsampled one by
  // one, are exactly the ancestor upsampled whole and cut into tiles, so
  // adjacent fallback tiles meet without a seam. What this guards is the
  // crop's OFFSET (column, row, depth): both sides run the same sampling
  // arithmetic, so it cannot catch an error in the sampling itself (the
  // hand-pinned crop above and the plane property do that). It does NOT
  // show that a fallback tile matches the ancestor drawn as it is: within
  // half an ancestor pixel of the ancestor's edge the sampling clamps to
  // the outer pixel centres, a flat strip (see the sidecar for its size),
  // and nothing here runs the library's own grid decode.
  it("tiles: each child equals its part of the whole ancestor upsampled", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 3 }),
        fc.constantFrom(2, 4, 8),
        fc.constantFrom(4, 8),
        fc.array(fc.double({ min: -500, max: 4_000, noNaN: true }), {
          minLength: 64,
          maxLength: 64,
        }),
        fc.nat(),
        (depth, src, dst, values, pick) => {
          const ancestor = tile(src, (x, y) => values[(y * src + x) % 64]!);
          const n = 2 ** depth;
          const col = pick % n;
          const row = Math.floor(pick / n) % n;
          const whole = resampleTerrarium(ancestor, src, dst * n);
          const child = resampleTerrarium(ancestor, src, dst, {
            depth,
            col,
            row,
          });
          for (let y = 0; y < dst; y++) {
            for (let x = 0; x < dst; x++) {
              expect(
                Math.abs(
                  heightAt(child, dst, x, y) -
                    heightAt(whole, dst * n, col * dst + x, row * dst + y),
                ),
              ).toBeLessThanOrEqual(1 / 256);
            }
          }
        },
      ),
    );
  });

  it("refuses sizes, data or a crop that do not match", () => {
    expect(() => resampleTerrarium(new Uint8ClampedArray(15), 2, 4)).toThrow(
      RangeError,
    );
    expect(() => resampleTerrarium(new Uint8ClampedArray(16), 2, 0)).toThrow(
      RangeError,
    );
    expect(() => resampleTerrarium(new Uint8ClampedArray(16), 2, 2.5)).toThrow(
      RangeError,
    );
    for (const crop of [
      { depth: -1, col: 0, row: 0 },
      { depth: 1.5, col: 0, row: 0 },
      { depth: 1, col: 2, row: 0 },
      { depth: 1, col: 0, row: -1 },
      { depth: 2, col: 0.5, row: 0 },
      { depth: RELIEF_FALLBACK.maxDepth + 1, col: 0, row: 0 },
    ]) {
      expect(() =>
        resampleTerrarium(new Uint8ClampedArray(16), 2, 4, crop),
      ).toThrow(RangeError);
    }
  });
});

/** A plugin as the library builds it: `loadRootTileset` creates `_source`. */
function fakePlugin(server: Map<string, Response>) {
  const fetched: { url: string; signal: unknown }[] = [];
  const source = {
    fetchOptions: { mode: "cors" },
    getUrl: (x: number, y: number, z: number) =>
      `https://primary/${z}/${x}/${y}.webp`,
    fetchData: (url: string, options: { signal?: unknown }) => {
      fetched.push({ url, signal: options.signal });
      const res = server.get(url);
      // A body can be read once; each request gets its own copy.
      return Promise.resolve(
        res ? res.clone() : new Response(null, { status: 404 }),
      );
    },
    processBufferToTexture: (buffer: ArrayBuffer) =>
      Promise.resolve({ kind: "primary", bytes: buffer.byteLength }),
    fetchItem: (_tokens: number[], _signal: unknown): Promise<unknown> =>
      Promise.reject(new Error("the library's own fetchItem")),
  };
  const plugin = {
    _source: null as typeof source | null,
    loadRootTileset() {
      this._source = source;
      return Promise.resolve({ root: true });
    },
  };
  return { plugin, source, fetched };
}

describe("installReliefFallback", () => {
  /**
   * The fakes: every ancestor decodes to a 4 px tile whose height is 10 x
   * column + row (pixel coordinates); the texture keeps the tile's first
   * height.
   */
  const options = () => ({
    tileDimension: 4,
    decodeRgba: vi.fn((_buffer: ArrayBuffer) =>
      Promise.resolve({
        data: tile(4, (x, y) => 10 * x + y),
        width: 4,
        height: 4,
      }),
    ),
    makeTexture: vi.fn((rgba: Uint8ClampedArray, size: number) =>
      Promise.resolve({
        kind: "ancestor",
        size,
        first: heightAt(rgba, size, 0, 0),
      }),
    ),
  });

  // Why: the source's own tiles must take the library's path untouched.
  it("leaves a tile the source has to the library", async () => {
    const server = new Map([
      ["https://primary/14/1/2.webp", new Response(new Uint8Array(7))],
    ]);
    const { plugin, source } = fakePlugin(server);
    const fallback = installReliefFallback(plugin, options());
    expect(await plugin.loadRootTileset()).toEqual({ root: true });
    const signal = new AbortController().signal;
    expect(await source.fetchItem([1, 2, 14], signal)).toEqual({
      kind: "primary",
      bytes: 7,
    });
    expect(fallback.stats()).toEqual({ fallbacks: 0, failures: 0 });
  });

  // Why: the case the spikes measured, and the review's fix: z14 and z13
  // answer 404 outside national coverage, z12 (Copernicus) exists. The
  // tile must be drawn from z12, cropped to where z14/8713/5678 lies in
  // that ancestor (column 8713 mod 4 = 1, row 5678 mod 4 = 2), upsampled to the
  // source's size, every request through the source's own fetch (the
  // download queue) with the tile's abort signal, no other host asked.
  it("draws the source's nearest ancestor on a 404, cropped and upsampled", async () => {
    const server = new Map([
      ["https://primary/12/2178/1419.webp", new Response(new Uint8Array(3))],
    ]);
    const { plugin, source, fetched } = fakePlugin(server);
    const fallback = installReliefFallback(plugin, options());
    await plugin.loadRootTileset();
    const signal = new AbortController().signal;
    const drawn = (await source.fetchItem([8713, 5678, 14], signal)) as {
      size: number;
      first: number;
    };
    expect(fetched.map((f) => f.url)).toEqual([
      "https://primary/14/8713/5678.webp",
      "https://primary/13/4356/2839.webp",
      "https://primary/12/2178/1419.webp",
    ]);
    expect(fetched.every((f) => f.signal === signal)).toBe(true);
    // Pixel 0's centre in the ancestor: x (1 + 1/8) / 4 x 4 - 0.5 = 0.625,
    // y (2 + 1/8) / 4 x 4 - 0.5 = 1.625, so 10 x 0.625 + 1.625.
    expect(drawn.size).toBe(4);
    expect(drawn.first).toBeCloseTo(7.875, 2);
    expect(fallback.stats()).toEqual({ fallbacks: 1, failures: 0 });
  });

  // Why (G1 re-review item 3): every walk asks from the tile up, keeping
  // no memory of earlier 404s. Mapterhorn's 404s carry
  // `cache-control: public, max-age=604800` (probed 2026-10-18), so the
  // browser's HTTP cache answers the repeats; a memory of its own would
  // let one transient or wrong 404 hide a region's real tiles for the
  // whole session. Here the z13 tile answers 404 once, then exists: the
  // next walk finds it.
  it("walks up from the tile every time, so a 404 that goes away is not remembered", async () => {
    const server = new Map([
      ["https://primary/12/2178/1419.webp", new Response(new Uint8Array(3))],
    ]);
    const { plugin, source, fetched } = fakePlugin(server);
    const fallback = installReliefFallback(plugin, options());
    await plugin.loadRootTileset();
    await source.fetchItem([8713, 5678, 14], undefined);
    fetched.length = 0;
    server.set(
      "https://primary/13/4356/2839.webp",
      new Response(new Uint8Array(5)),
    );
    await source.fetchItem([8712, 5679, 14], undefined); // a sibling
    expect(fetched.map((f) => f.url)).toEqual([
      "https://primary/14/8712/5679.webp",
      "https://primary/13/4356/2839.webp",
    ]);
    expect(fallback.stats()).toEqual({ fallbacks: 2, failures: 0 });
  });

  // Why (G1 re-review item 6): `failures` is what the lab and G2 read to
  // tell a broken source from a quiet one, so it counts every rejection
  // the library will mark failed (a network error, an image that does not
  // decode), not only the statuses this module names. An abort is the
  // library cancelling a tile it no longer wants: not a failure.
  it("counts every rejection but an abort as a failure", async () => {
    const opts = options();
    const { plugin, source } = fakePlugin(new Map());
    const fallback = installReliefFallback(plugin, opts);
    await plugin.loadRootTileset();
    source.fetchData = () => Promise.reject(new TypeError("Failed to fetch"));
    await expect(source.fetchItem([1, 1, 14], undefined)).rejects.toThrow(
      TypeError,
    );
    source.fetchData = () =>
      Promise.reject(new DOMException("aborted", "AbortError"));
    await expect(source.fetchItem([1, 1, 14], undefined)).rejects.toThrow(
      /aborted/,
    );
    source.fetchData = (url: string) =>
      Promise.resolve(
        url.includes("/14/")
          ? new Response(null, { status: 404 })
          : new Response(new Uint8Array(3)),
      );
    opts.decodeRgba.mockRejectedValueOnce(new Error("not an image"));
    await expect(source.fetchItem([1, 1, 14], undefined)).rejects.toThrow(
      /not an image/,
    );
    expect(fallback.stats()).toEqual({ fallbacks: 0, failures: 2 });
  });

  // Why: the library does not check the status; an error page decoded as
  // heights would fail obscurely. Other failures reject with the status,
  // and a tile with no ancestor at all (every level 404) rejects too: the
  // library then marks it failed and a coarser tile stands in.
  it("rejects, naming the status, on another error or with no ancestor", async () => {
    const server = new Map([
      ["https://primary/14/1/3.webp", new Response(null, { status: 503 })],
      ["https://primary/13/0/0.webp", new Response(null, { status: 500 })],
    ]);
    const { plugin, source } = fakePlugin(server);
    const fallback = installReliefFallback(plugin, options());
    await plugin.loadRootTileset();
    await expect(source.fetchItem([1, 3, 14], undefined)).rejects.toThrow(
      /503/,
    );
    // 14/1/1 is missing; its parent 13/0/0 fails with 500.
    await expect(source.fetchItem([1, 1, 14], undefined)).rejects.toThrow(
      /500/,
    );
    await expect(source.fetchItem([9, 9, 4], undefined)).rejects.toThrow(
      /no ancestor/,
    );
    expect(fallback.stats()).toEqual({ fallbacks: 0, failures: 3 });
  });

  it("restores the plugin on dispose, and refuses what it cannot use", () => {
    const { plugin } = fakePlugin(new Map());
    const own = plugin.loadRootTileset;
    const fallback = installReliefFallback(plugin, options());
    expect(plugin.loadRootTileset).not.toBe(own);
    fallback.dispose();
    expect(plugin.loadRootTileset).toBe(own);
    expect(() =>
      installReliefFallback(plugin, { ...options(), tileDimension: 0 }),
    ).toThrow(RangeError);
    expect(() => installReliefFallback({} as never, options())).toThrow(
      TypeError,
    );
  });
});
