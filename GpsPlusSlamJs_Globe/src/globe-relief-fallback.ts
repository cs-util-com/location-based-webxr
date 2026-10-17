/**
 * The relief's fallback where its source has no tile (tour editor plan
 * 2026-10-17-1816 §13, G1 step 2; G0 spikes, "Coverage"): Mapterhorn's
 * fine zooms exist only where a national model does and answer 404
 * elsewhere. The library's image source neither checks the status nor
 * knows a second source; this asks the fallback (AWS Terrarium) for the
 * same tile, and resamples its HEIGHTS to the source's tile size, since
 * the library refills each grid's border from same-sized neighbours.
 *
 * @see globe-relief-fallback.ts.md
 */
import * as THREE from "three";

import { isTileTemplate } from "./globe-relief-source.js";

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
 * A square Terrarium tile of `srcSize` px resampled to `dstSize` px:
 * heights decoded, sampled bilinearly at the destination's pixel centres
 * (both tiles cover the same extent; centres beyond the source's outer
 * centres take the edge), encoded again. The same size returns a copy.
 * RangeError for a size that is not a positive integer or data whose
 * length is not `srcSize² x 4`.
 */
export function resampleTerrarium(
  rgba: Uint8ClampedArray | Uint8Array,
  srcSize: number,
  dstSize: number,
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
  if (srcSize === dstSize) return new Uint8ClampedArray(rgba);
  const heights = new Float64Array(srcSize * srcSize);
  for (let k = 0; k < heights.length; k++) {
    heights[k] = decodeTerrariumM(
      rgba[4 * k]!,
      rgba[4 * k + 1]!,
      rgba[4 * k + 2]!,
    );
  }
  const out = new Uint8ClampedArray(dstSize * dstSize * 4);
  const scale = srcSize / dstSize;
  const last = srcSize - 1;
  for (let y = 0; y < dstSize; y++) {
    const fy = Math.min(last, Math.max(0, (y + 0.5) * scale - 0.5));
    const y0 = Math.floor(fy);
    const y1 = Math.min(y0 + 1, last);
    const ty = fy - y0;
    for (let x = 0; x < dstSize; x++) {
      const fx = Math.min(last, Math.max(0, (x + 0.5) * scale - 0.5));
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

/** `url` with every `{z}`, `{x}` and `{y}` filled. */
export function fillTileTemplate(
  url: string,
  z: number,
  x: number,
  y: number,
): string {
  return url
    .replaceAll("{z}", String(z))
    .replaceAll("{x}", String(x))
    .replaceAll("{y}", String(y));
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

/**
 * Installs the fallback on the library's terrain plugin: once its root
 * load has made the image source, each height tile is fetched through the
 * source's own `fetchData` (the download queue, the tile's abort signal);
 * a tile the source has takes the library's `processBufferToTexture`; on
 * a 404 the same z/x/y is fetched from `fallbackUrl`, decoded
 * (`decodeRgba`), resampled to `tileDimension` (`resampleTerrarium`) and
 * made a texture (`makeTexture`). Any other failure rejects, naming the
 * status. `stats()` counts fallbacks and failures; `dispose()` restores
 * the root load (a source already made keeps its fetch). TypeError for a
 * plugin without `loadRootTileset`; RangeError for a template without
 * `{z}/{x}/{y}` or a tile size that is not a positive integer.
 */
export function installReliefFallback(
  plugin: FallbackPlugin,
  {
    fallbackUrl,
    tileDimension,
    decodeRgba = browserDecodeRgba,
    makeTexture = browserTexture,
  }: {
    fallbackUrl: string;
    tileDimension: number;
    decodeRgba?: (buffer: ArrayBuffer) => Promise<DecodedRgba>;
    makeTexture?: (rgba: Uint8ClampedArray, size: number) => Promise<unknown>;
  },
): { stats(): { fallbacks: number; failures: number }; dispose(): void } {
  if (typeof plugin?.loadRootTileset !== "function") {
    throw new TypeError("the relief fallback needs the plugin's root load");
  }
  if (!isTileTemplate(fallbackUrl)) {
    throw new RangeError(
      `the relief fallback needs a {z}/{x}/{y} template, got ${String(fallbackUrl)}`,
    );
  }
  if (!isSize(tileDimension)) {
    throw new RangeError(
      `the relief fallback needs the source's tile size, got ${tileDimension}`,
    );
  }
  let fallbacks = 0;
  let failures = 0;
  const fail = (message: string): never => {
    failures++;
    throw new Error(message);
  };
  const fetchTile = async (
    source: ReliefImageSource,
    tokens: number[],
    signal: unknown,
  ): Promise<unknown> => {
    const [x = 0, y = 0, level = 0] = tokens;
    const options = { ...source.fetchOptions, signal };
    const url = source.getUrl(x, y, level);
    const res = await source.fetchData(url, options);
    if (res.ok) return source.processBufferToTexture(await res.arrayBuffer());
    if (res.status !== 404)
      return fail(`height tile ${url}: HTTP ${res.status}`);
    const other = fillTileTemplate(fallbackUrl, level, x, y);
    const back = await source.fetchData(other, options);
    if (!back.ok) {
      return fail(
        `height tile ${url}: 404, and its fallback HTTP ${back.status}`,
      );
    }
    const image = await decodeRgba(await back.arrayBuffer());
    if (image.width !== image.height) {
      return fail(`fallback tile ${other} is not square`);
    }
    fallbacks++;
    return makeTexture(
      resampleTerrarium(image.data, image.width, tileDimension),
      tileDimension,
    );
  };
  // eslint-disable-next-line @typescript-eslint/unbound-method -- restored as it was
  const ownRoot = plugin.loadRootTileset;
  plugin.loadRootTileset = async function (this: FallbackPlugin) {
    const result = await ownRoot.call(this);
    const source = this._source;
    if (source) {
      source.fetchItem = (tokens, signal) => fetchTile(source, tokens, signal);
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
