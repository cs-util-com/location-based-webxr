/**
 * The terrain lab's far field (terrain plan 2026-09-27-0605 §4 style C
 * "Globe blend", §9 findings 11 and 12; research 2026-09-27-0600 §6.3): the
 * globe's own Blue Marble imagery under the terrain, blended into the near
 * style by the camera's altitude, so the later dive from the globe crosses
 * a seam between two images that already agree.
 *
 * - WHICH IMAGERY: the globe's committed EPSG:4326 pyramid (served at
 *   `/globe-assets/`, level 4 is about 2.4 km a pixel), not a new source.
 * - HOW IT REACHES THE SHADER: resampled once on the page onto a square
 *   grid over the drawn region in the lab's ENU frame (`farFieldGrid`), so
 *   the shader reads it by position, like every other texture of the lab.
 * - WHAT "MATCHES THE GLOBE" MEANS (finding 12): the imagery texel through
 *   the globe's tone mapping (three's Neutral, exposure 1) with nothing
 *   else applied, which is what the globe draws for ground lit straight
 *   from above. `farColour` is that reference; the shader uses three's own
 *   tone-mapping chunk and this file mirrors it for the tests.
 * - THE BLEND follows the (smoothed) camera altitude: the near style's
 *   weight rises from 0 at `highKm` to 1 at `lowKm`, and the far field's
 *   own relief texture fades in from twice `highKm` to `highKm`.
 *
 * Dependency-free, so it runs on the page and under `node --test`.
 *
 * @see terrain-far-field.js.md
 */
import { smoothstep } from "./terrain-style.js";

/** The far field's defaults and the imagery it reads. */
export const FAR_FIELD = Object.freeze({
  /** The pyramid level read: the finest the globe commits (0-4). */
  level: 4,
  tileSize: 256,
  /** The grid's texels per side over the drawn region (2 km at 256 km). */
  side: 128,
  /** Near style weight 0 above `highKm`, 1 below `lowKm` (research §6.3). */
  highKm: 1500,
  lowKm: 300,
});

/**
 * The EPSG:4326 tiles covering a lat/lng box at a level: 2 x 2^z columns
 * from 180° W and 2^z rows from 90° N, each 180 / 2^z degrees (the globe's
 * `tile-pyramid.ts` layout). Row by row, north first.
 *
 * @param {{ west: number, south: number, east: number, north: number }} box
 * @param {number} level
 * @returns {{ z: number, x: number, y: number }[]}
 */
export function imageryTiles(box, level) {
  if (!(Number.isInteger(level) && level >= 0)) {
    throw new RangeError(`level must be a non-negative integer, got ${level}`);
  }
  if (!(box.west <= box.east && box.south <= box.north)) {
    throw new RangeError(`not a box: ${JSON.stringify(box)}`);
  }
  const rows = 2 ** level;
  const size = 180 / rows;
  const col = (lng) =>
    Math.min(2 * rows - 1, Math.max(0, Math.floor((lng + 180) / size)));
  const row = (lat) =>
    Math.min(rows - 1, Math.max(0, Math.floor((90 - lat) / size)));
  const tiles = [];
  for (let y = row(box.north); y <= row(box.south); y++) {
    for (let x = col(box.west); x <= col(box.east); x++) {
      tiles.push({ z: level, x, y });
    }
  }
  return tiles;
}

/**
 * The lat/lng box of a square `±halfM` around a frame's origin, from its
 * four corners (the frame is equirectangular, so they bound it), widened by
 * one imagery pixel so bilinear sampling at the edge has its neighbours.
 */
export function regionBox(toLatLng, halfM, pixelDeg = 0) {
  const corners = [
    [-halfM, -halfM],
    [halfM, -halfM],
    [-halfM, halfM],
    [halfM, halfM],
  ].map(([x, y]) => toLatLng({ x, y }));
  return {
    west: Math.min(...corners.map((c) => c.lng)) - pixelDeg,
    east: Math.max(...corners.map((c) => c.lng)) + pixelDeg,
    south: Math.min(...corners.map((c) => c.lat)) - pixelDeg,
    north: Math.max(...corners.map((c) => c.lat)) + pixelDeg,
  };
}

/**
 * Bilinear sRGB (0-1) of decoded imagery tiles at a position, each pixel's
 * value at its CENTRE; null where a contributing pixel is missing.
 *
 * @param {{ z: number, x: number, y: number, width: number, height: number,
 *   data: Uint8ClampedArray | Uint8Array }[]} tiles  RGBA rows, north first
 */
export function sampleImagery(tiles, lat, lng) {
  if (tiles.length === 0) return null;
  const z = tiles[0].z;
  const size = tiles[0].width;
  const degPerPx = 180 / 2 ** z / size;
  const byKey = new Map(tiles.map((t) => [`${t.x}/${t.y}`, t]));
  // Global pixel coordinates, the centre of pixel i at i + 0.5.
  const gx = (lng + 180) / degPerPx - 0.5;
  const gy = (90 - lat) / degPerPx - 0.5;
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const pixel = (px, py) => {
    const t = byKey.get(`${Math.floor(px / size)}/${Math.floor(py / size)}`);
    if (!t) return null;
    const i = 4 * ((py - t.y * size) * size + (px - t.x * size));
    return [t.data[i] / 255, t.data[i + 1] / 255, t.data[i + 2] / 255];
  };
  const p00 = pixel(x0, y0);
  const p10 = pixel(x0 + 1, y0);
  const p01 = pixel(x0, y0 + 1);
  const p11 = pixel(x0 + 1, y0 + 1);
  if (!p00 || !p10 || !p01 || !p11) return null;
  const fx = gx - x0;
  const fy = gy - y0;
  return p00.map(
    (v, c) =>
      (v * (1 - fx) + p10[c] * fx) * (1 - fy) +
      (p01[c] * (1 - fx) + p11[c] * fx) * fy,
  );
}

/**
 * The far field's grid: `side` x `side` RGBA bytes over `±halfM`, texel i
 * centred at `-halfM + (i + 0.5) x 2 halfM / side`, row 0 at the SOUTH edge
 * (the order of the lab's other grids). A texel the imagery cannot answer
 * is written with alpha 0 (the shader then keeps the near style).
 *
 * @param {{ side: number, halfM: number,
 *   toLatLng: (p: {x: number, y: number}) => {lat: number, lng: number},
 *   sample: (lat: number, lng: number) => number[] | null }} input
 */
export function farFieldGrid({ side, halfM, toLatLng, sample }) {
  if (!(Number.isInteger(side) && side >= 2)) {
    throw new RangeError(`side must be an integer >= 2, got ${side}`);
  }
  const out = new Uint8Array(side * side * 4);
  const step = (2 * halfM) / side;
  for (let r = 0; r < side; r++) {
    for (let c = 0; c < side; c++) {
      const { lat, lng } = toLatLng({
        x: -halfM + (c + 0.5) * step,
        y: -halfM + (r + 0.5) * step,
      });
      const rgb = sample(lat, lng);
      const i = 4 * (r * side + c);
      if (rgb === null) continue;
      out[i] = Math.round(rgb[0] * 255);
      out[i + 1] = Math.round(rgb[1] * 255);
      out[i + 2] = Math.round(rgb[2] * 255);
      out[i + 3] = 255;
    }
  }
  return out;
}

/**
 * Bilinear read of a far-field grid at ENU metres (x east, y north), sRGB
 * 0-1, the texel centres as `farFieldGrid` places them and clamped at the
 * edge (as the shader's texture is); null where any contributor is empty.
 */
export function farFieldAt(grid, side, halfM, x, y) {
  const step = (2 * halfM) / side;
  const clamp = (v) => Math.min(side - 1, Math.max(0, v));
  const gx = clamp((x + halfM) / step - 0.5);
  const gy = clamp((y + halfM) / step - 0.5);
  const x0 = Math.min(side - 2, Math.floor(gx));
  const y0 = Math.min(side - 2, Math.floor(gy));
  const fx = gx - x0;
  const fy = gy - y0;
  const texel = (c, r) => {
    const i = 4 * (r * side + c);
    return grid[i + 3] === 0
      ? null
      : [grid[i] / 255, grid[i + 1] / 255, grid[i + 2] / 255];
  };
  const q = [texel(x0, y0), texel(x0 + 1, y0), texel(x0, y0 + 1)];
  q.push(texel(x0 + 1, y0 + 1));
  if (q.some((t) => t === null)) return null;
  return q[0].map(
    (v, c) =>
      (v * (1 - fx) + q[1][c] * fx) * (1 - fy) +
      (q[2][c] * (1 - fx) + q[3][c] * fx) * fy,
  );
}

/** The sRGB decoding curve (three's `sRGBTransferEOTF`), one channel. */
export function srgbToLinear(c) {
  return c <= 0.04045
    ? c * 0.0773993808
    : (c * 0.9478672986 + 0.0521327014) ** 2.4;
}

/** The sRGB encoding curve (three's `sRGBTransferOETF`), one channel. */
export function linearToSrgb(c) {
  return c <= 0.0031308 ? c * 12.92 : 1.055 * c ** 0.41666 - 0.055;
}

/**
 * three's `NeutralToneMapping` (r185, `tonemapping_pars_fragment`), line
 * for line: a small toe below 0.08, and above 0.76 a compressed peak with
 * a slight desaturation. Linear in, linear out.
 */
export function neutralToneMap(rgb, exposure = 1) {
  const startCompression = 0.8 - 0.04;
  const desaturation = 0.15;
  let c = rgb.map((v) => v * exposure);
  const x = Math.min(...c);
  const offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
  c = c.map((v) => v - offset);
  const peak = Math.max(...c);
  if (peak < startCompression) return c;
  const d = 1 - startCompression;
  const newPeak = 1 - (d * d) / (peak + d - startCompression);
  c = c.map((v) => (v * newPeak) / peak);
  const g = 1 - 1 / (desaturation * (peak - newPeak) + 1);
  return c.map((v) => v + (newPeak - v) * g);
}

/**
 * The far field's colour for an imagery texel (sRGB 0-1): what the globe
 * draws for it lit from straight above, through its tone mapping.
 */
export function farColour(srgb) {
  return neutralToneMap(srgb.map(srgbToLinear)).map((v) =>
    Math.min(1, Math.max(0, linearToSrgb(Math.max(0, v)))),
  );
}

/**
 * The blend at a camera altitude: `near`, the near style's weight (0 far
 * above `highKm`, 1 below `lowKm`), and `relief`, the far field's own relief
 * texture (0 above twice `highKm`, 1 below `highKm`). Both are 0 when the
 * far field is off... except `near`, which is then 1.
 */
export function farWeights(
  altitudeM,
  { on, highKm = FAR_FIELD.highKm, lowKm = FAR_FIELD.lowKm },
) {
  if (!on) return { near: 1, relief: 0 };
  const km = altitudeM / 1000;
  return {
    near: smoothstep(highKm, lowKm, km),
    relief: smoothstep(2 * highKm, highKm, km),
  };
}
