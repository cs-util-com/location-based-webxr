/**
 * The relief's fallback where its source has no tile (tour editor plan
 * 2026-10-17-1816 §13, G1 step 2; G0 spikes, "Coverage"; G1 review M2):
 * Mapterhorn's fine zooms exist only where a national model does, and its
 * deep-ocean tiles at no zoom finer than about z5; it answers 404
 * elsewhere. The library's image source neither checks the status nor
 * knows what else to draw; this draws the tile from the same source's
 * nearest ancestor, cropped to the tile and upsampled to its size (the
 * library refills each grid's border from same-sized neighbours). One
 * pyramid: no step between two sources at a coverage border, which a
 * second source at the same tile gave (AWS, +5 to +12 m off in towns, G0).
 *
 * @see globe-relief-fallback.ts.md
 */
import * as THREE from "three";

export const RELIEF_FALLBACK = Object.freeze({
  /**
   * The deepest crop: an ancestor this many levels up (the relief tree's
   * own limit, `GLOBE_TERRAIN.maxMeshLevel`).
   */
  maxDepth: 24,
});

/** The Terrarium offset (m): encoded = height + 32768. */
const OFFSET_M = 32_768;
/** The encoding's top: 0xffffff / 256. */
const MAX_ENCODED = 0xff_ff_ff / 256;

/** A height (m) from a Terrarium pixel, the library's formula. */
export function decodeTerrariumM(r: number, g: number, b: number): number {
  return r * 256 + g + b / 256 - OFFSET_M;
}

/**
 * Writes `heightM` as a Terrarium pixel at `out[i..i+3]` (alpha 255),
 * rounded to the encoding's 1/256 m and clamped to its range.
 */
export function encodeTerrarium(
  heightM: number,
  out: Uint8ClampedArray | Uint8Array,
  i: number,
): void {
  const v = Math.min(MAX_ENCODED, Math.max(0, heightM + OFFSET_M));
  const q = Math.round(v * 256);
  out[i] = Math.floor(q / 65_536);
  out[i + 1] = Math.floor(q / 256) % 256;
  out[i + 2] = q % 256;
  out[i + 3] = 255;
}

const isSize = (n: number): boolean => Number.isInteger(n) && n >= 1;

/**
 * Where a tile lies in its ancestor `depth` levels up: its column and row
 * (north first, as XYZ counts) among the ancestor's 2^depth x 2^depth.
 */
export interface AncestorCrop {
  readonly depth: number;
  readonly col: number;
  readonly row: number;
}

const WHOLE: AncestorCrop = Object.freeze({ depth: 0, col: 0, row: 0 });

/** RangeError unless `crop` names a part of its ancestor. */
function checkCrop({ depth, col, row }: AncestorCrop): void {
  const n = 2 ** depth;
  const inRange = (v: number) => Number.isInteger(v) && v >= 0 && v < n;
  if (
    !(
      Number.isInteger(depth) &&
      depth >= 0 &&
      depth <= RELIEF_FALLBACK.maxDepth
    ) ||
    !inRange(col) ||
    !inRange(row)
  ) {
    throw new RangeError(
      `a crop is a depth 0-${RELIEF_FALLBACK.maxDepth} and a column and row below 2^depth, got ${depth}, ${col}, ${row}`,
    );
  }
}

/**
 * The part `crop` of a square Terrarium tile of `srcSize` px (the whole
 * tile by default), resampled to `dstSize` px: heights decoded, sampled
 * bilinearly at the destination's pixel centres (a centre beyond the
 * source's outer centres takes the edge, so a strip half a source pixel
 * wide along the source's border is flat: up to (2^(depth-1) - 0.5)
 * destination pixels x the slope off, see the sidecar), encoded again. A part is
 * exactly the whole tile resampled to `dstSize` x 2^depth and cut: the
 * children of one ancestor meet without a seam. The whole tile at the
 * same size returns a copy. RangeError for a size that is not a positive
 * integer, data whose length is not `srcSize² x 4`, or a crop outside
 * the tile.
 */
export function resampleTerrarium(
  rgba: Uint8ClampedArray | Uint8Array,
  srcSize: number,
  dstSize: number,
  crop: AncestorCrop = WHOLE,
): Uint8ClampedArray {
  if (!isSize(srcSize) || !isSize(dstSize)) {
    throw new RangeError(
      `tile sizes are positive integers, got ${srcSize} and ${dstSize}`,
    );
  }
  if (rgba.length !== srcSize * srcSize * 4) {
    throw new RangeError(
      `a ${srcSize} px tile has ${srcSize * srcSize * 4} bytes, got ${rgba.length}`,
    );
  }
  checkCrop(crop);
  if (srcSize === dstSize && crop.depth === 0) {
    return new Uint8ClampedArray(rgba);
  }
  const heights = new Float64Array(srcSize * srcSize);
  for (let k = 0; k < heights.length; k++) {
    heights[k] = decodeTerrariumM(
      rgba[4 * k]!,
      rgba[4 * k + 1]!,
      rgba[4 * k + 2]!,
    );
  }
  const out = new Uint8ClampedArray(dstSize * dstSize * 4);
  // A destination centre (i + 0.5) / dstSize of the tile lies at (offset +
  // that) / 2^depth of the ancestor, in its pixels x srcSize - 0.5.
  const parts = 2 ** crop.depth;
  const scale = srcSize / (dstSize * parts);
  const last = srcSize - 1;
  const at = (offset: number, i: number) =>
    Math.min(last, Math.max(0, (offset * dstSize + i + 0.5) * scale - 0.5));
  for (let y = 0; y < dstSize; y++) {
    const fy = at(crop.row, y);
    const y0 = Math.floor(fy);
    const y1 = Math.min(y0 + 1, last);
    const ty = fy - y0;
    for (let x = 0; x < dstSize; x++) {
      const fx = at(crop.col, x);
      const x0 = Math.floor(fx);
      const x1 = Math.min(x0 + 1, last);
      const tx = fx - x0;
      const top =
        heights[y0 * srcSize + x0]! * (1 - tx) +
        heights[y0 * srcSize + x1]! * tx;
      const bottom =
        heights[y1 * srcSize + x0]! * (1 - tx) +
        heights[y1 * srcSize + x1]! * tx;
      encodeTerrarium(top * (1 - ty) + bottom * ty, out, 4 * (y * dstSize + x));
    }
  }
  return out;
}

/** Decoded RGBA rows, north first, as an image's pixels. */
export interface DecodedRgba {
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
}

/** The library's image source, as far as the fallback uses it (0.5.3). */
interface ReliefImageSource {
  fetchOptions?: Record<string, unknown>;
  getUrl(x: number, y: number, level: number): string;
  fetchData(url: string, options: Record<string, unknown>): Promise<Response>;
  processBufferToTexture(buffer: ArrayBuffer): Promise<unknown>;
  fetchItem(tokens: number[], signal: unknown): Promise<unknown>;
}

/** The plugin, as far as the fallback uses it: its root load makes `_source`. */
interface FallbackPlugin {
  loadRootTileset(): Promise<unknown>;
  _source?: ReliefImageSource | null;
}

/** Pixels from an encoded image, colour untouched (the library's options). */
async function browserDecodeRgba(buffer: ArrayBuffer): Promise<DecodedRgba> {
  const bitmap = await createImageBitmap(new Blob([buffer]), {
    premultiplyAlpha: "none",
    colorSpaceConversion: "none",
  });
  const { width, height } = bitmap;
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("the relief fallback needs a 2D canvas");
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return { data: ctx.getImageData(0, 0, width, height).data, width, height };
}

/** A texture as the library's `processBufferToTexture` makes one. */
async function browserTexture(
  rgba: Uint8ClampedArray,
  size: number,
): Promise<THREE.Texture> {
  const bitmap = await createImageBitmap(
    new ImageData(new Uint8ClampedArray(rgba), size, size),
    {
      premultiplyAlpha: "none",
      colorSpaceConversion: "none",
      imageOrientation: "flipY",
    },
  );
  const texture = new THREE.Texture(bitmap);
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

/** The library cancelling a tile it no longer wants: not a failure. */
const isAbort = (error: unknown): boolean =>
  (error as { name?: unknown } | null)?.name === "AbortError";

/**
 * Installs the fallback on the library's terrain plugin: once its root
 * load has made the image source, each height tile is fetched through the
 * source's own `fetchData` (the download queue, the tile's abort signal);
 * a tile the source has takes the library's `processBufferToTexture`. On a
 * 404 it walks up the same source's pyramid to the nearest ancestor that
 * exists, decodes it (`decodeRgba`), crops the tile's part of it and
 * upsamples that to `tileDimension` (`resampleTerrarium`), and makes it a
 * texture (`makeTexture`). Every walk starts at the tile itself and keeps
 * no memory of earlier 404s: the source's 404s are cached by the browser
 * (Mapterhorn's carry a week's `max-age`), and a memory would let one
 * transient 404 hide a region for the session. Any other status, or no
 * ancestor at all, rejects, naming it; the library then marks the tile
 * failed and a coarser one stands in. `stats()` counts fallbacks and
 * failures (every rejection but an abort); `dispose()` restores the root load (a source
 * already made keeps its fetch). TypeError for a plugin without
 * `loadRootTileset`; RangeError for a tile size that is not a positive
 * integer.
 */
export function installReliefFallback(
  plugin: FallbackPlugin,
  {
    tileDimension,
    decodeRgba = browserDecodeRgba,
    makeTexture = browserTexture,
  }: {
    tileDimension: number;
    decodeRgba?: (buffer: ArrayBuffer) => Promise<DecodedRgba>;
    makeTexture?: (rgba: Uint8ClampedArray, size: number) => Promise<unknown>;
  },
): { stats(): { fallbacks: number; failures: number }; dispose(): void } {
  if (typeof plugin?.loadRootTileset !== "function") {
    throw new TypeError("the relief fallback needs the plugin's root load");
  }
  if (!isSize(tileDimension)) {
    throw new RangeError(
      `the relief fallback needs the source's tile size, got ${tileDimension}`,
    );
  }
  let fallbacks = 0;
  let failures = 0;
  const fetchTile = async (
    source: ReliefImageSource,
    tokens: number[],
    signal: unknown,
  ): Promise<unknown> => {
    const [x = 0, y = 0, level = 0] = tokens;
    const options = { ...source.fetchOptions, signal };
    for (let depth = 0; depth <= level; depth++) {
      const url = source.getUrl(x >> depth, y >> depth, level - depth);
      const res = await source.fetchData(url, options);
      if (res.status === 404) continue;
      if (!res.ok) throw new Error(`height tile ${url}: HTTP ${res.status}`);
      if (depth === 0) {
        return source.processBufferToTexture(await res.arrayBuffer());
      }
      const image = await decodeRgba(await res.arrayBuffer());
      if (image.width !== image.height) {
        throw new Error(`height tile ${url} is not square`);
      }
      const mask = 2 ** depth - 1;
      const rgba = resampleTerrarium(image.data, image.width, tileDimension, {
        depth,
        col: x & mask,
        row: y & mask,
      });
      const texture = await makeTexture(rgba, tileDimension);
      fallbacks++;
      return texture;
    }
    throw new Error(
      `height tile ${source.getUrl(x, y, level)}: 404, and no ancestor`,
    );
  };
  // eslint-disable-next-line @typescript-eslint/unbound-method -- restored as it was
  const ownRoot = plugin.loadRootTileset;
  plugin.loadRootTileset = async function (this: FallbackPlugin) {
    const result = await ownRoot.call(this);
    const source = this._source;
    if (source) {
      source.fetchItem = (tokens, signal) =>
        fetchTile(source, tokens, signal).catch((error: unknown) => {
          if (!isAbort(error)) failures++;
          throw error;
        });
    }
    return result;
  };
  return {
    stats: () => ({ fallbacks, failures }),
    dispose() {
      plugin.loadRootTileset = ownRoot;
    },
  };
}
