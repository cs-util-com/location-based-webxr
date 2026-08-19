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
import { InFlightRequests } from "../source/in-flight-requests.js";
import type { ElevationProvider } from "./elevation-provider.js";

/** AWS Open Data, no authentication and no documented rate limit. */
export const TERRARIUM_URL_TEMPLATE =
  "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";

export const TERRARIUM_ATTRIBUTION =
  "Elevation data © Mapzen / AWS Open Data Terrain Tiles, sourced from SRTM, NED and others";

/**
 * Mapterhorn: national open LiDAR terrain compiled into terrarium-encoded
 * tiles, with Copernicus GLO-30 as the fallback where no LiDAR exists.
 *
 * Same terrarium encoding as the AWS tiles, but WebP-compressed and — the part
 * that bites — **512-px tiles**, not 256. `TerrariumProvider` groups by tile
 * index (size-invariant) and rescales the within-tile offset to the decoded
 * size, so the template drops in as `urlTemplate` with no other configuration.
 * `browserPngDecoder()` already decodes WebP: `createImageBitmap` sniffs the
 * content, the "Png" in the name is historical.
 */
export const MAPTERHORN_URL_TEMPLATE =
  "https://tiles.mapterhorn.com/{z}/{x}/{y}.webp";

export const MAPTERHORN_ATTRIBUTION =
  "Elevation data © Mapterhorn (national LiDAR sources, Copernicus GLO-30)";

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

/** Mercator cannot represent the poles; clamped rather than emitting NaN. */
const MAX_MERCATOR_LAT = 85.0511287798;

export interface TilePixel {
  readonly z: number;
  readonly x: number;
  readonly y: number;
  /** Pixel position within the tile, fractional. Origin top-left. */
  readonly px: number;
  readonly py: number;
}

/**
 * The tile size all tile/pixel arithmetic in this module defaults to.
 *
 * ONE CONSTANT, AND IT IS ALSO THE DEFAULT `tileSize` of `toTilePixel`,
 * `toWorldPixel` and `fromWorldPixel` below — the provider's rescale divides
 * by the same value those functions multiplied by, so a literal `256` in
 * either place could drift from the other silently and skew every within-tile
 * offset.
 *
 * Tile INDICES are size-invariant — `toWorldPixel` scales with 2^z · tileSize,
 * so `worldX / tileSize` names the same tile for any size — which is why the
 * provider can group positions into tiles before it has fetched a single one
 * and learned how big they are. The WITHIN-TILE offset is not size-invariant:
 * it scales with the tile's actual pixel width, so sampling rescales it by
 * `tile.size / TILE_MATH_SIZE` once the decoded size is known.
 */
const TILE_MATH_SIZE = 256;

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
  tileSize = TILE_MATH_SIZE,
): TilePixel {
  const { x: worldX, y: worldY } = toWorldPixel(position, zoom, tileSize);
  const tileX = Math.floor(worldX / tileSize);
  const tileY = Math.floor(worldY / tileSize);
  return {
    z: zoom,
    x: tileX,
    y: tileY,
    px: worldX - tileX * tileSize,
    py: worldY - tileY * tileSize,
  };
}

/** A continuous position on the Web Mercator pixel plane at one zoom. */
export interface WorldPixel {
  readonly x: number;
  readonly y: number;
}

/**
 * Continuous Web Mercator pixel coordinates, un-floored.
 *
 * WHY THIS IS SEPARATE FROM {@link toTilePixel}. A tile-plus-offset is the right
 * shape for *fetching* a raster, and the wrong shape for *indexing a lattice*: a
 * consumer building a cache of height posts wants one monotonic integer grid over
 * the whole world, not a pair of coordinates that resets at every tile boundary.
 * Deriving one from the other is easy to get subtly wrong at a boundary, which is
 * exactly where a terrain seam would appear.
 *
 * The pixel grid at a given zoom is also the DEM's OWN sampling grid, so a
 * consumer that snaps its posts to integers here samples the source at its native
 * resolution — no resampling, and no invented detail.
 */
export function toWorldPixel(
  position: LatLng,
  zoom: number,
  tileSize = TILE_MATH_SIZE,
): WorldPixel {
  const lat = Math.min(
    MAX_MERCATOR_LAT,
    Math.max(-MAX_MERCATOR_LAT, position.lat),
  );
  const lng = ((((position.lng + 180) % 360) + 360) % 360) - 180;

  const scale = 2 ** zoom * tileSize;
  const sinLat = Math.sin((lat * Math.PI) / 180);
  return {
    x: ((lng + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * scale,
  };
}

/**
 * The exact inverse of {@link toWorldPixel}.
 *
 * Needed by any consumer that indexes a lattice in pixel space and then has to ask
 * an elevation provider for those posts — the provider's API is lat/lng, so the
 * round trip has to close. It is the inverse rather than an approximation of it,
 * and `terrarium.property.test.ts` pins that: an approximate inverse would drift
 * the lattice off the DEM's pixel centres, which reintroduces the resampling this
 * exists to avoid.
 */
export function fromWorldPixel(
  point: WorldPixel,
  zoom: number,
  tileSize = TILE_MATH_SIZE,
): LatLng {
  const scale = 2 ** zoom * tileSize;
  const lng = (point.x / scale) * 360 - 180;
  // Inverse Gudermannian: undoes the log((1+sin)/(1-sin)) / (4*pi) above.
  const n = Math.PI * (1 - (2 * point.y) / scale);
  const lat = (Math.atan(Math.sinh(n)) * 180) / Math.PI;
  return { lat, lng };
}

/**
 * The signal governing one tile fetch: the caller's, the deadline's, or both.
 *
 * `AbortSignal.any` is only reached when there really are two, purely to avoid
 * allocating a composite that stays subscribed to its sources until it is
 * collected. **That is the whole reason, and an earlier version of this comment
 * claimed a second one that is false:** `AbortSignal.any` also preserves its
 * source's `reason` *identity* (the spec assigns the source's reason object to
 * the composite), so the `AbortError` / `TimeoutError` discrimination in `load`
 * does not depend on the single-source path at all.
 *
 * Worth knowing before trusting the shape: with a deadline configured, the
 * single-source path is never taken. `load` always has the dedup controller's
 * signal, so `present.length` is 2 whenever `requestTimeoutMs` is set and 1
 * otherwise. The zero case is unreachable today and kept only so the helper is
 * total rather than partial.
 */
function composeSignals(
  ...signals: readonly (AbortSignal | undefined)[]
): AbortSignal | undefined {
  const present = signals.filter((s): s is AbortSignal => s !== undefined);
  if (present.length === 0) return undefined;
  if (present.length === 1) return present[0];
  return AbortSignal.any(present);
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
  /**
   * How long one tile request may take before it degrades to "no data", ms.
   *
   * **WHY A PROVIDER MAY NEED A DEADLINE AT ALL, since the seam already says a
   * provider never throws for missing data.** Because "never answers" is not
   * "no data" — it is no answer, and it is the one outcome a composed provider
   * cannot route around. `fallbackProvider` consults its fallback only for
   * positions the primary returned `undefined` for, so a primary that is merely
   * SLOW produces no gap and the fallback is never asked. Measured 2026-08-19:
   * one host served a z13 tile in 3–21 s while another served the same ground
   * in 0.8–1.0 s, which is enough to exceed a consumer's whole terrain budget
   * and take the working source down with it.
   *
   * **UNSET BY DEFAULT, deliberately.** A library-wide default deadline would
   * silently change behaviour for every existing consumer, and the right value
   * depends entirely on what the caller is composing: a sole provider wants
   * patience, a primary in front of a fast fallback wants impatience. The
   * consumer picks. `dem-provider.ts` in the OSM demo is the worked example.
   *
   * **IT IS A `TimeoutError`, NOT AN `AbortError`, and that is load-bearing.**
   * `load` rethrows aborts (a caller that left wants no answer) and degrades
   * everything else. A deadline spelled as an abort would therefore reject the
   * whole batch instead of degrading it — reintroducing the exact failure it
   * was added to remove. `AbortSignal.timeout` yields `TimeoutError`, which
   * lands on the degrade branch. Pinned by `terrarium.test.ts`.
   */
  readonly requestTimeoutMs?: number;
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
  private readonly requestTimeoutMs: number | undefined;

  private readonly tiles = new Map<string, ElevationTile>();
  /**
   * One fetch per tile, however many positions ask for it at once.
   *
   * `InFlightRequests` rather than a plain map because the callers joining here
   * do not share a lifetime: the DEM tile under a position is very likely to be
   * wanted by an unrelated later query, so the first caller's signal must not
   * govern theirs. See `../source/in-flight-requests.ts`.
   */
  private readonly inFlight = new InFlightRequests<ElevationTile | undefined>();

  /**
   * `timeouts` is counted SEPARATELY from `decodeFailures`, and that split is
   * the point rather than tidiness. Both degrade a tile to `undefined` through
   * the same catch, so folding them together makes "the primary is too slow"
   * indistinguishable from "the primary is serving corrupt tiles" — two
   * problems with entirely different remedies. It is also the only per-source
   * evidence of slowness this package records, which is where any future
   * adaptive behaviour would have to start.
   */
  readonly stats = {
    fetches: 0,
    cacheHits: 0,
    decodeFailures: 0,
    timeouts: 0,
  };

  constructor(options: TerrariumProviderOptions) {
    this.decodePng = options.decodePng;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.zoom = options.zoom ?? DEFAULT_TERRARIUM_ZOOM;
    this.urlTemplate = options.urlTemplate ?? TERRARIUM_URL_TEMPLATE;
    this.maxCachedTiles = options.maxCachedTiles ?? 64;
    this.requestTimeoutMs = options.requestTimeoutMs;
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
      // `p.px`/`p.py` were computed at TILE_MATH_SIZE; the decoded tile may be
      // larger (512-px terrarium services exist). The tile index is the same
      // either way, but the offset scales with the actual size — sampling
      // without this rescale reads only the tile's top-left quadrant.
      const s = tile.size / TILE_MATH_SIZE;
      return sampleTile(tile, p.px * s, p.py * s);
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

    return this.inFlight.join(
      key,
      (dedupSignal) => this.load(key, z, x, y, dedupSignal),
      signal,
    );
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

    // THE DEADLINE IS COMPOSED, NOT SUBSTITUTED. Both signals have to reach the
    // fetch: the caller's (or rather the dedup controller's — see `tile`) says
    // "nobody wants this any more", the deadline says "this is taking too long
    // to be useful". Dropping either one loses a distinct cancellation reason,
    // and the two are handled differently three lines below.
    //
    // ONE CONSEQUENCE WORTH KNOWING: `signal` here is `InFlightRequests`'
    // internal controller, shared by every caller joined to this tile. So the
    // deadline is shared too — the first joiner's clock bounds them all, and a
    // late joiner inherits a budget already part-spent. That is the right
    // trade for a tile cache (one fetch serves everyone, so one verdict serves
    // everyone) but it does mean the deadline is per-TILE, not per-caller.
    const deadline =
      this.requestTimeoutMs === undefined
        ? undefined
        : AbortSignal.timeout(this.requestTimeoutMs);
    const composed = composeSignals(signal, deadline);

    try {
      this.stats.fetches++;
      const response = await this.fetchImpl(
        url,
        composed ? { signal: composed } : {},
      );
      if (!response.ok) return undefined;
      const image = await this.decodePng(await response.arrayBuffer());
      const tile = toElevationTile(image, z, x, y);
      this.remember(key, tile);
      return tile;
    } catch (error) {
      // An abort must propagate — a caller that left the area is not asking for
      // a degraded answer, it is asking for no answer.
      //
      // A DEADLINE IS NOT AN ABORT and must NOT land here. `AbortSignal.timeout`
      // rejects with a `TimeoutError`, so it falls through to the degrade branch
      // below and the composed provider's fallback gets its chance. This is the
      // whole reason the deadline is not spelled `controller.abort()`: that
      // yields an `AbortError`, this line would rethrow it, and the batch would
      // fail instead of degrading — the failure the deadline exists to prevent.
      if (error instanceof Error && error.name === "AbortError") throw error;
      // Everything else degrades: a missing or corrupt terrain tile means "no
      // elevation here", never a thrown batch. COUNTED APART, though, because
      // "too slow" and "corrupt" are the same outcome and completely different
      // problems — see `stats`.
      if (error instanceof Error && error.name === "TimeoutError") {
        this.stats.timeouts++;
      } else {
        this.stats.decodeFailures++;
      }
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
 * A raster decoder built on browser APIs.
 *
 * Works on the main thread and in a Worker (`OffscreenCanvas` is available in
 * both). Throws where those APIs do not exist rather than pretending — a Node
 * caller must supply its own decoder, and the failure should name that.
 *
 * Despite the name it is NOT PNG-specific: `createImageBitmap` sniffs the
 * bytes' actual format, so WebP-compressed terrarium tiles (e.g. Mapterhorn's)
 * decode through the same path. The "Png" in the name is historical — the
 * first tile source happened to serve PNG.
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
