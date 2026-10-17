/**
 * The relief's fallback where its source has no tile (tour editor plan
 * 2026-10-17-1816 §13, G1 step 2; G0 spikes, "Coverage").
 *
 * Why this test matters: Mapterhorn's fine zooms (13 and finer) exist only
 * where a national model does; elsewhere it answers 404, and the library
 * neither checks the status nor has a second source, so the tile failed to
 * decode. The fallback asks AWS Terrarium for the same tile. Its tiles are
 * 256 px, Mapterhorn's 512, and the library refills each height grid's
 * border from its neighbours assuming they have the same size, so the
 * fallback's HEIGHTS are resampled to 512 (decoded first: interpolating
 * the encoded bytes would mix the high and low bytes of a height into
 * nonsense, a step of 256 m in red is one of 1 m in green).
 */
import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";

import {
  decodeTerrariumM,
  encodeTerrarium,
  fillTileTemplate,
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

  it("refuses sizes or data that do not match", () => {
    expect(() => resampleTerrarium(new Uint8ClampedArray(15), 2, 4)).toThrow(
      RangeError,
    );
    expect(() => resampleTerrarium(new Uint8ClampedArray(16), 2, 0)).toThrow(
      RangeError,
    );
    expect(() => resampleTerrarium(new Uint8ClampedArray(16), 2, 2.5)).toThrow(
      RangeError,
    );
  });
});

describe("fillTileTemplate", () => {
  it("fills z, x and y, every occurrence", () => {
    expect(
      fillTileTemplate("https://h/{z}/{x}/{y}.png?z={z}", 14, 8_712, 5_678),
    ).toBe("https://h/14/8712/5678.png?z=14");
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
      return Promise.resolve(
        server.get(url) ?? new Response(null, { status: 404 }),
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
  const options = {
    fallbackUrl: "https://fallback/{z}/{x}/{y}.png",
    tileDimension: 4,
    decodeRgba: vi.fn((_buffer: ArrayBuffer) =>
      Promise.resolve({ data: tile(2, () => 100), width: 2, height: 2 }),
    ),
    makeTexture: vi.fn((rgba: Uint8ClampedArray, size: number) =>
      Promise.resolve({
        kind: "fallback",
        size,
        first: heightAt(rgba, size, 0, 0),
      }),
    ),
  };

  // Why: the source's own tiles must take the library's path untouched.
  it("leaves a tile the source has to the library", async () => {
    const server = new Map([
      ["https://primary/14/1/2.webp", new Response(new Uint8Array(7))],
    ]);
    const { plugin, source } = fakePlugin(server);
    const fallback = installReliefFallback(plugin, options);
    expect(await plugin.loadRootTileset()).toEqual({ root: true });
    const signal = new AbortController().signal;
    expect(await source.fetchItem([1, 2, 14], signal)).toEqual({
      kind: "primary",
      bytes: 7,
    });
    expect(fallback.stats()).toEqual({ fallbacks: 0, failures: 0 });
  });

  // Why: the case the spikes measured: z14 404 outside national coverage.
  it("asks the fallback for the same tile on a 404, resampled to the source's size", async () => {
    const server = new Map([
      ["https://fallback/14/1/2.png", new Response(new Uint8Array(3))],
    ]);
    const { plugin, source, fetched } = fakePlugin(server);
    const fallback = installReliefFallback(plugin, options);
    await plugin.loadRootTileset();
    const signal = new AbortController().signal;
    expect(await source.fetchItem([1, 2, 14], signal)).toEqual({
      kind: "fallback",
      size: 4,
      first: 100,
    });
    // Both requests through the source's own fetch (the download queue),
    // with the tile's abort signal.
    expect(fetched.map((f) => f.url)).toEqual([
      "https://primary/14/1/2.webp",
      "https://fallback/14/1/2.png",
    ]);
    expect(fetched.every((f) => f.signal === signal)).toBe(true);
    expect(fallback.stats()).toEqual({ fallbacks: 1, failures: 0 });
  });

  // Why: the library does not check the status; an error page decoded as
  // heights would fail obscurely. Other failures reject with the status.
  it("rejects, naming the status, on another error or a missing fallback tile", async () => {
    const server = new Map([
      ["https://primary/14/1/3.webp", new Response(null, { status: 503 })],
    ]);
    const { plugin, source } = fakePlugin(server);
    const fallback = installReliefFallback(plugin, options);
    await plugin.loadRootTileset();
    await expect(source.fetchItem([1, 3, 14], undefined)).rejects.toThrow(
      /503/,
    );
    await expect(source.fetchItem([9, 9, 14], undefined)).rejects.toThrow(
      /404/,
    );
    expect(fallback.stats()).toEqual({ fallbacks: 0, failures: 2 });
  });

  it("restores the plugin on dispose, and refuses what it cannot use", () => {
    const { plugin } = fakePlugin(new Map());
    const own = plugin.loadRootTileset;
    const fallback = installReliefFallback(plugin, options);
    expect(plugin.loadRootTileset).not.toBe(own);
    fallback.dispose();
    expect(plugin.loadRootTileset).toBe(own);
    expect(() =>
      installReliefFallback(plugin, {
        ...options,
        fallbackUrl: "https://x/{z}.png",
      }),
    ).toThrow(RangeError);
    expect(() =>
      installReliefFallback(plugin, { ...options, tileDimension: 0 }),
    ).toThrow(RangeError);
    expect(() => installReliefFallback({} as never, options)).toThrow(
      TypeError,
    );
  });
});
