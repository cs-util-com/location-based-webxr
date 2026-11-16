/**
 * CIE L*a*b* (D65) for the city's sRGB hex colours, both ways.
 *
 * The building palette's per-building lightness jitter is stated in L*, the
 * perceptual lightness a colour scheme's value ladder is designed in, so a
 * shift of 3 means the same visible step on a dark stone as on a limestone.
 * The conversion is the standard one: the sRGB curve (`srgb.ts`), the sRGB
 * primaries to XYZ, and the CIE 1976 cube-root mapping against the D65 white.
 *
 * @see cielab.ts.md
 */

import type { Rgb } from "./feature-colours.js";
import { linearToSrgb, srgbToLinear } from "./srgb.js";

/** A colour in CIE L*a*b*: `l` 0-100, `a` and `b` roughly -128..128. */
export interface Lab {
  readonly l: number;
  readonly a: number;
  readonly b: number;
}

/** The D65 reference white in XYZ (Y = 1). */
const WHITE_X = 0.95047;
const WHITE_Z = 1.08883;
/** The CIE 1976 knee, 6/29. */
const DELTA = 6 / 29;

function f(t: number): number {
  return t > DELTA ** 3 ? Math.cbrt(t) : t / (3 * DELTA * DELTA) + 4 / 29;
}

function fInverse(t: number): number {
  return t > DELTA ? t ** 3 : 3 * DELTA * DELTA * (t - 4 / 29);
}

/** An sRGB hex colour (0..0xffffff) in L*a*b*. */
export function rgbToLab(rgb: Rgb): Lab {
  const r = srgbToLinear(((rgb >> 16) & 0xff) / 255);
  const g = srgbToLinear(((rgb >> 8) & 0xff) / 255);
  const b = srgbToLinear((rgb & 0xff) / 255);
  const x = 0.4124564 * r + 0.3575761 * g + 0.1804375 * b;
  const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  const z = 0.0193339 * r + 0.119192 * g + 0.9503041 * b;
  const fx = f(x / WHITE_X);
  const fy = f(y);
  const fz = f(z / WHITE_Z);
  return { l: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

/** One linear channel to an 8-bit sRGB value, clamped (NaN reads as 0). */
function channel(linear: number): number {
  return Math.round(linearToSrgb(linear) * 255);
}

/**
 * An L*a*b* colour as the nearest sRGB hex colour. A colour outside the sRGB
 * gamut is clamped per channel, and NaN reads as 0, so the result is always
 * an integer in 0..0xffffff.
 */
export function labToRgb(lab: Lab): Rgb {
  const fy = (lab.l + 16) / 116;
  const fx = fy + lab.a / 500;
  const fz = fy - lab.b / 200;
  const x = WHITE_X * fInverse(fx);
  const y = fInverse(fy);
  const z = WHITE_Z * fInverse(fz);
  const r = 3.2404542 * x - 1.5371385 * y - 0.4985314 * z;
  const g = -0.969266 * x + 1.8760108 * y + 0.041556 * z;
  const b = 0.0556434 * x - 0.2040259 * y + 1.0572252 * z;
  return (channel(r) << 16) | (channel(g) << 8) | channel(b);
}
