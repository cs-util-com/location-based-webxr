/**
 * Then and now's soft edge: the old picture fades out over a thin band at
 * its border instead of ending on a hard line, as on the chosen page
 * (its `uFeather` 0.035 of the width at the sides, half as much again at
 * the top and bottom). Given to the overlay as a shared alpha map, so the
 * overlay stays a basic material whose opacity the view and the station's
 * fade keep writing.
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

/** The alpha map's side (px): the band spans 9 texels at the default
 *  width, so filtering keeps it a ramp. */
const MAP_PX = 256;

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

let featherMap: DataTexture | null = null;

/** The feather at its default width as an alpha map (green channel, as
 *  three reads one): made once, shared by every overlay, never freed. */
export function thenNowFeatherMap(): DataTexture {
  if (featherMap !== null) return featherMap;
  const data = new Uint8Array(MAP_PX * MAP_PX * 4);
  for (let y = 0; y < MAP_PX; y += 1) {
    for (let x = 0; x < MAP_PX; x += 1) {
      const a = Math.round(
        255 * thenNowFeather(x / (MAP_PX - 1), y / (MAP_PX - 1)),
      );
      const i = (y * MAP_PX + x) * 4;
      data[i] = a;
      data[i + 1] = a;
      data[i + 2] = a;
      data[i + 3] = 255;
    }
  }
  const map = new DataTexture(
    data,
    MAP_PX,
    MAP_PX,
    RGBAFormat,
    UnsignedByteType,
  );
  map.name = "then-now-feather";
  map.magFilter = LinearFilter;
  map.minFilter = LinearFilter;
  map.wrapS = ClampToEdgeWrapping;
  map.wrapT = ClampToEdgeWrapping;
  map.needsUpdate = true;
  featherMap = map;
  return map;
}
