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
  TerrariumProvider,
  decodeTerrarium,
  sampleTile,
  toElevationTile,
  toTilePixel,
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
