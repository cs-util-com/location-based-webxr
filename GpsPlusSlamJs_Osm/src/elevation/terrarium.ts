/**
 * Terrarium terrain tiles — decoding, tile arithmetic, and the provider.
 *
 * WHY RASTER TILES AT ALL. The C# reference looked elevation up **per point**
 * against point-query APIs, five points per heat tile. That does not survive
 * the move to res 13: the public OpenTopoData endpoint allows 100 locations per
 * request, 1 request/second and 1,000 requests/day, while a single res-7 fetch
 * tile holds ~117,649 res-13 cells — roughly six times the entire daily global
 * quota, for one tile. A raster tile is decoded ONCE and then sampled for any
 * number of points at zero marginal cost, which is the only thing that makes
 * elevation at this resolution possible at all.
 *
 * WHY THE PNG DECODER IS INJECTED. This package has one peer dependency and no
 * runtime dependencies, and it must run in a Web Worker, on the main thread and
 * in Node. There is no PNG decoder common to all three: the browser has
 * `createImageBitmap` + `OffscreenCanvas`, Node has none without a dependency.
 * So the decoder is a parameter. `browserPngDecoder()` supplies the browser
 * one; tests supply a synthetic one and never touch an image codec at all,
 * which is also what makes the decode maths testable byte-exactly.
 *
 * @see terrarium.ts.md
 */

import type { LatLng } from "../model/osm-feature.js";
import type { ElevationProvider } from "./elevation-provider.js";

/** AWS Open Data, no authentication and no documented rate limit. */
export const TERRARIUM_URL_TEMPLATE =
  "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";

export const TERRARIUM_ATTRIBUTION =
  "Elevation data © Mapzen / AWS Open Data Terrain Tiles, sourced from SRTM, NED and others";

/**
 * Default zoom.
 *
 * z=13, NOT the z=14 the plan first wrote. A Web Mercator tile shrinks with
 * latitude: at 50.8° N a z=14 tile spans ~1.55 km, so covering one 2.81 km res-7
 * fetch tile takes a 3 × 3 block — nine requests per area, which is precisely
 * the cost the res-8 → res-7 move was made to avoid. z=13 spans ~3.1 km there,
 * so a res-7 hexagon fits in a 2 × 2 block at worst and often 1–2 tiles.
 *
 * The accuracy given up is nominal: ~12 m/pixel against ~6 m/pixel, while the
 * underlying data is largely SRTM/NED at ~30 m posting. Sampling finer than the
 * source buys interpolated pixels and nothing else, so the zoom is chosen for
 * tile-count convenience, which is the only axis where it makes a difference.
 */
export const DEFAULT_TERRARIUM_ZOOM = 13;

/** A decoded raster: RGBA bytes, row-major from the top-left. */
export interface DecodedImage {
  readonly width: number;
  readonly height: number;
  /** RGBA, 4 bytes per pixel. */
  readonly data: Uint8ClampedArray;
}

export type PngDecoder = (bytes: ArrayBuffer) => Promise<DecodedImage>;

/**
 * Terrarium encoding: metres with a +32,768 offset across RGB.
 *
 * 16 bits of integer metres in R and G, 8 bits of fraction in B. Exact by
 * construction — there is no tolerance here, so the tests assert equality.
 */
export function decodeTerrarium(r: number, g: number, b: number): number {
  return r * 256 + g + b / 256 - 32768;
}

export interface TilePixel {
  readonly z: number;
  readonly x: number;
  readonly y: number;
  /** Pixel position within the tile, fractional. Origin top-left. */
  readonly px: number;
  readonly py: number;
}

/**
 * Web Mercator tile and fractional pixel for a position.
 *
 * `tileSize` is the tile's pixel width; Terrarium tiles are 256.
 *
 * Latitude is clamped to the Mercator limit (±85.0511°) rather than allowed to
 * produce `Infinity`. A pole is not a place this library is used, and silently
 * emitting NaN tile indices would surface as a failed fetch with no cause.
 */
export function toTilePixel(
  position: LatLng,
  zoom: number,
  tileSize = 256,
): TilePixel {
  const MAX_LAT = 85.0511287798;
  const lat = Math.min(MAX_LAT, Math.max(-MAX_LAT, position.lat));
  const lng = ((((position.lng + 180) % 360) + 360) % 360) - 180;

  const scale = 2 ** zoom;
  const worldX = ((lng + 180) / 360) * scale;
  const sinLat = Math.sin((lat * Math.PI) / 180);
  const worldY =
    (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * scale;

  const x = Math.floor(worldX);
  const y = Math.floor(worldY);
  return {
    z: zoom,
    x,
    y,
    px: (worldX - x) * tileSize,
    py: (worldY - y) * tileSize,
  };
}

/** Key for a decoded tile in the cache. */
function tileKey(z: number, x: number, y: number): string {
  return `${z}/${x}/${y}`;
}

/**
 * A decoded tile's elevations as a `Float32Array`, row-major.
 *
 * Kept as a typed array rather than an object array because it transfers rather
 * than copies across a worker boundary, and because a 256 × 256 tile is 65,536
 * samples — the one place in this package where the representation matters.
 */
export interface ElevationTile {
  readonly z: number;
  readonly x: number;
  readonly y: number;
  readonly size: number;
  readonly samples: Float32Array;
}

/** Decodes a Terrarium image into an elevation grid. */
export function toElevationTile(
  image: DecodedImage,
  z: number,
  x: number,
  y: number,
): ElevationTile {
  const size = image.width;
  if (image.height !== size) {
    throw new Error(
      `Terrarium tile ${tileKey(z, x, y)} is ${image.width}×${image.height}; expected square`,
    );
  }

  const samples = new Float32Array(size * size);
  for (let i = 0; i < size * size; i++) {
    const o = i * 4;
    samples[i] = decodeTerrarium(
      image.data[o] ?? 0,
      image.data[o + 1] ?? 0,
      image.data[o + 2] ?? 0,
    );
  }
  return { z, x, y, size, samples };
}

/**
 * Bilinear sample at a fractional pixel.
 *
 * Bilinear rather than nearest because the whole point of decoding a raster is
 * that sampling is free afterwards, and a nearest-neighbour read makes terrain
 * look like a staircase at ~12 m/pixel — visible in an AR overlay at walking
 * distance. Edge pixels clamp rather than wrap: the neighbouring tile is a
 * separate fetch, and clamping is wrong by at most half a pixel where wrapping
 * would be wrong by half the planet.
 */
export function sampleTile(
  tile: ElevationTile,
  px: number,
  py: number,
): number {
  const max = tile.size - 1;
  const x0 = Math.min(max, Math.max(0, Math.floor(px)));
  const y0 = Math.min(max, Math.max(0, Math.floor(py)));
  const x1 = Math.min(max, x0 + 1);
  const y1 = Math.min(max, y0 + 1);
  const fx = Math.min(1, Math.max(0, px - x0));
  const fy = Math.min(1, Math.max(0, py - y0));

  const at = (x: number, y: number): number =>
    tile.samples[y * tile.size + x] ?? 0;

  const top = at(x0, y0) * (1 - fx) + at(x1, y0) * fx;
  const bottom = at(x0, y1) * (1 - fx) + at(x1, y1) * fx;
  return top * (1 - fy) + bottom * fy;
}

export interface TerrariumProviderOptions {
  readonly decodePng: PngDecoder;
  readonly fetchImpl?: typeof fetch;
  readonly zoom?: number;
  readonly urlTemplate?: string;
  /** Decoded tiles retained. 64 × 256 KB ≈ 16 MB of Float32Array. */
  readonly maxCachedTiles?: number;
}

/**
 * Elevation from Terrarium raster tiles, decoded once and sampled thereafter.
 */
export class TerrariumProvider implements ElevationProvider {
  readonly attribution = TERRARIUM_ATTRIBUTION;
  readonly sourceId = "terrarium";

  private readonly decodePng: PngDecoder;
  private readonly fetchImpl: typeof fetch;
  private readonly zoom: number;
  private readonly urlTemplate: string;
  private readonly maxCachedTiles: number;

  private readonly tiles = new Map<string, ElevationTile>();
  /** One fetch per tile, however many positions ask for it at once. */
  private readonly inFlight = new Map<
    string,
    Promise<ElevationTile | undefined>
  >();

  readonly stats = { fetches: 0, cacheHits: 0, decodeFailures: 0 };

  constructor(options: TerrariumProviderOptions) {
    this.decodePng = options.decodePng;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.zoom = options.zoom ?? DEFAULT_TERRARIUM_ZOOM;
    this.urlTemplate = options.urlTemplate ?? TERRARIUM_URL_TEMPLATE;
    this.maxCachedTiles = options.maxCachedTiles ?? 64;
  }

  async elevationAt(
    positions: readonly LatLng[],
    signal?: AbortSignal,
  ): Promise<readonly (number | undefined)[]> {
    // GROUP BY TILE FIRST. A working set of 931 cells spans one or two tiles, so
    // resolving per position would issue hundreds of identical fetches. This is
    // the same "one request per area, not per point" move the raster approach
    // exists to make, applied one level up.
    const placed = positions.map((p) => toTilePixel(p, this.zoom));
    const needed = new Set(placed.map((t) => tileKey(t.z, t.x, t.y)));

    const loaded = new Map<string, ElevationTile | undefined>();
    await Promise.all(
      [...needed].map(async (key) => {
        const [z, x, y] = key.split("/").map(Number);
        loaded.set(
          key,
          await this.tile(z as number, x as number, y as number, signal),
        );
      }),
    );

    return placed.map((p) => {
      const tile = loaded.get(tileKey(p.z, p.x, p.y));
      if (tile === undefined) return undefined;
      return sampleTile(tile, p.px, p.py);
    });
  }

  private async tile(
    z: number,
    x: number,
    y: number,
    signal?: AbortSignal,
  ): Promise<ElevationTile | undefined> {
    const key = tileKey(z, x, y);
    const cached = this.tiles.get(key);
    if (cached !== undefined) {
      this.stats.cacheHits++;
      return cached;
    }

    const existing = this.inFlight.get(key);
    if (existing !== undefined) return existing;

    const pending = this.load(key, z, x, y, signal).finally(() => {
      this.inFlight.delete(key);
    });
    this.inFlight.set(key, pending);
    return pending;
  }

  private async load(
    key: string,
    z: number,
    x: number,
    y: number,
    signal?: AbortSignal,
  ): Promise<ElevationTile | undefined> {
    const url = this.urlTemplate
      .replace("{z}", String(z))
      .replace("{x}", String(x))
      .replace("{y}", String(y));

    try {
      this.stats.fetches++;
      const response = await this.fetchImpl(url, signal ? { signal } : {});
      if (!response.ok) return undefined;
      const image = await this.decodePng(await response.arrayBuffer());
      const tile = toElevationTile(image, z, x, y);
      this.remember(key, tile);
      return tile;
    } catch (error) {
      // An abort must propagate — a caller that left the area is not asking for
      // a degraded answer, it is asking for no answer.
      if (error instanceof Error && error.name === "AbortError") throw error;
      // Everything else degrades: a missing or corrupt terrain tile means "no
      // elevation here", never a thrown batch.
      this.stats.decodeFailures++;
      return undefined;
    }
  }

  private remember(key: string, tile: ElevationTile): void {
    this.tiles.set(key, tile);
    // Insertion-ordered eviction: terrain is walked through, so the oldest
    // decoded tile is the one furthest behind. A Float32Array per tile is
    // 256 KB, which is small enough to be careless with and large enough to
    // matter over a day's walking.
    while (this.tiles.size > this.maxCachedTiles) {
      const oldest = this.tiles.keys().next().value;
      if (oldest === undefined) break;
      this.tiles.delete(oldest);
    }
  }
}

/**
 * A PNG decoder built on browser APIs.
 *
 * Works on the main thread and in a Worker (`OffscreenCanvas` is available in
 * both). Throws where those APIs do not exist rather than pretending — a Node
 * caller must supply its own decoder, and the failure should name that.
 */
export function browserPngDecoder(): PngDecoder {
  return async (bytes: ArrayBuffer): Promise<DecodedImage> => {
    if (
      typeof createImageBitmap !== "function" ||
      typeof OffscreenCanvas !== "function"
    ) {
      throw new Error(
        "browserPngDecoder needs createImageBitmap and OffscreenCanvas. " +
          "In Node, pass your own `decodePng`.",
      );
    }
    // BOTH OPT-OUTS ARE LOAD-BEARING, not defensive habit. `decodeTerrarium`
    // treats R/G/B as an exact 24-bit fixed-point number, but this path is
    // *allowed* to rewrite that triple on the way through: a `gAMA`, `sRGB` or
    // `iCCP` chunk in the PNG lets the user agent colour-manage it, and alpha
    // premultiplication can shift it again. Both default to "the UA may".
    //
    // A one-step shift in R is 256 METRES of elevation, arriving as a smooth
    // plausible surface rather than an error — the exact failure this module is
    // organised around. Terrarium tiles are data that happens to be PNG-encoded,
    // not pictures, so every stage of image pipeline politeness is wrong here.
    const bitmap = await createImageBitmap(new Blob([bytes]), {
      colorSpaceConversion: "none",
      premultiplyAlpha: "none",
    });
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    // The canvas is never composited or animated — it exists only to hand the
    // bytes back — so a GPU-backed surface is the wrong trade for a full read.
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (ctx === null) throw new Error("OffscreenCanvas 2d context unavailable");
    ctx.drawImage(bitmap, 0, 0);
    const image = ctx.getImageData(0, 0, bitmap.width, bitmap.height, {
      colorSpace: "srgb",
    });
    bitmap.close();
    return { width: image.width, height: image.height, data: image.data };
  };
}
