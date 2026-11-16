/**
 * Then and now's soft edge: the old picture fades out over a thin band at
 * its border instead of ending on a hard line, as on the chosen page
 * (its `uFeather` 0.035 of the width at the sides, half as much again at
 * the top and bottom). Given to the overlay as a shared alpha map, so the
 * overlay stays a basic material whose opacity the view and the station's
 * fade keep writing. The viewer's and sharpen's planes take the same
 * edge at their own widths.
 *
 * @see then-now-feather.ts.md
 */
import {
  ClampToEdgeWrapping,
  DataTexture,
  LinearFilter,
  RGBAFormat,
  UnsignedByteType,
} from "three";

import { smoothstep } from "../../smoothstep.js";

/** The band's width as a share of the picture's width (its height's band
 *  is 1.5 x this share of the height). */
export const THEN_NOW_FEATHER = 0.035;

/** The top and bottom band over the sides'. */
const TOP_SHARE = 1.5;

/** The alpha map's least side (px), and the texels its band must span
 *  so that filtering keeps it a ramp: 256 px gives the default width 9;
 *  a narrower feather takes the next power of two that gives it as many. */
const MAP_MIN_PX = 256;
const BAND_TEXELS = 8;

function mapPx(feather: number): number {
  let px = MAP_MIN_PX;
  while (px * feather < BAND_TEXELS && px < 4096) px *= 2;
  return px;
}

/**
 * How much of the picture shows at `(u, v)` (0..1 across and up): 0 at
 * any edge and off the picture, 1 once `feather` in from the sides and
 * `1.5 x feather` in from the top and bottom. A point that is no number
 * shows nothing; a feather that is no positive number is none.
 */
export function thenNowFeather(
  u: number,
  v: number,
  feather: number = THEN_NOW_FEATHER,
): number {
  if (!(u >= 0 && u <= 1 && v >= 0 && v <= 1)) return 0;
  if (!(feather > 0)) return 1;
  const side = feather;
  const top = feather * TOP_SHARE;
  return (
    smoothstep(0, side, u) *
    smoothstep(0, side, 1 - u) *
    smoothstep(0, top, v) *
    smoothstep(0, top, 1 - v)
  );
}

const featherMaps = new Map<number, DataTexture>();

/** The feather `feather` wide (the default: then and now's) as an alpha
 *  map (green channel, as three reads one): made once per width, shared
 *  by every overlay, never freed (a part detaches it before it frees its
 *  look). */
export function thenNowFeatherMap(
  feather: number = THEN_NOW_FEATHER,
): DataTexture {
  const made = featherMaps.get(feather);
  if (made !== undefined) return made;
  const side = mapPx(feather);
  const data = new Uint8Array(side * side * 4);
  for (let y = 0; y < side; y += 1) {
    for (let x = 0; x < side; x += 1) {
      const a = Math.round(
        255 * thenNowFeather(x / (side - 1), y / (side - 1), feather),
      );
      const i = (y * side + x) * 4;
      data[i] = a;
      data[i + 1] = a;
      data[i + 2] = a;
      data[i + 3] = 255;
    }
  }
  const map = new DataTexture(data, side, side, RGBAFormat, UnsignedByteType);
  map.name = "then-now-feather";
  map.magFilter = LinearFilter;
  map.minFilter = LinearFilter;
  map.wrapS = ClampToEdgeWrapping;
  map.wrapT = ClampToEdgeWrapping;
  map.needsUpdate = true;
  featherMaps.set(feather, map);
  return map;
}
