/**
 * The water alpha the fetch script writes into each imagery tile (round-4
 * plan 2026-09-28-2105 DEC-GL4-6): 0 on water, 255 on land. Water is where
 * GIBS's MODIS water mask (MOD44W, cut to the same tile) says water AND the
 * imagery itself shows dark sea. The mask alone marks the mixed pixel
 * between sea and bright land as water, and a whole texel of sand then
 * glinted (the coast smoke, 5 km inland); the imagery's colour decides that
 * pixel instead. A pure function, so the hand-run script's rule is
 * unit-tested.
 *
 * @see water-alpha.ts.md
 */

/**
 * Water is darker than this in every channel (8-bit sRGB, the lossless
 * source's values). Blue Marble's open sea: brightest channel 99th
 * percentile 35; land: median 79 (research 2026-09-28-2129 §2.3). How much
 * of the mask's water it turns to land barely depends on it: 3.40-3.88 % at
 * 90-40 over levels 3-5, mostly bright sea ice beyond 55° (5.98 %, which
 * should not glint either), 0.48 % elsewhere.
 */
export const WATER_MAX_BRIGHTNESS = 55;

/**
 * Whether GIBS's mask pixel `p` says water (opaque cyan); Error naming it
 * when it is neither that nor land (transparent, or opaque black).
 */
function maskSaysWater(mask: DataView, p: number): boolean {
  const rgba = mask.getUint32(4 * p);
  const [r, g, b, a] = [
    rgba >>> 24,
    (rgba >>> 16) & 255,
    (rgba >>> 8) & 255,
    rgba & 255,
  ];
  const isWater = a === 255 && g >= 240 && b >= 240;
  const isLand = a === 0 || (r === 0 && g === 0 && b === 0);
  if (!isWater && !isLand) {
    throw new Error(`mask pixel ${p} is ${[r, g, b, a].join(",")}`);
  }
  return isWater;
}

/** Whether imagery pixel `p` is dark sea: every channel under the limit. */
function looksLikeSea(imagery: Uint8Array, p: number): boolean {
  const [r = 0, g = 0, b = 0] = imagery.subarray(3 * p, 3 * p + 3);
  return Math.max(r, g, b) < WATER_MAX_BRIGHTNESS;
}

/**
 * One alpha byte per pixel, from the mask as RGBA (GIBS draws water cyan,
 * opaque; land transparent or opaque black) and the imagery as RGB, both
 * `count` pixels. Error (naming the pixel) for any other mask colour, since
 * a style change would otherwise become a wrong coastline silently;
 * RangeError when a buffer does not hold `count` pixels.
 */
export function waterAlpha(
  mask: Uint8Array,
  imagery: Uint8Array,
  count: number,
): Uint8Array {
  const whole = Number.isInteger(count) && count >= 0;
  if (!whole || mask.length !== 4 * count || imagery.length !== 3 * count) {
    throw new RangeError(
      `expected ${count} pixels, got a ${mask.length}-byte mask and ${imagery.length}-byte imagery`,
    );
  }
  const view = new DataView(mask.buffer, mask.byteOffset, mask.byteLength);
  const alpha = new Uint8Array(count).fill(255);
  for (let p = 0; p < count; p++) {
    if (maskSaysWater(view, p) && looksLikeSea(imagery, p)) alpha[p] = 0;
  }
  return alpha;
}
