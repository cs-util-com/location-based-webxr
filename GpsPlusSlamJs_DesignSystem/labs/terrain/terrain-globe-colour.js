/**
 * The terrain lab's relief coloured from the globe imagery (globe round-5
 * plan 2026-10-01-0945 §3.3; the owner's core idea, feedback 2026-10-01-0936
 * §4): the Blue Marble pixels the globe already shows, blended with the
 * elevation data, so the relief looks detailed although only heights are
 * fetched. Two approaches, each a lab style:
 *
 * - `globe-albedo` (C1): the imagery's colour, bilinear, as the albedo under
 *   the sun term (`terrain-sun.js`), plus a `detail` weight (0-1) adding a
 *   LUMINANCE-ONLY high-pass from style B's height/slope ramp: the ratio of
 *   the ramp's luminance at the fragment to its mean over the imagery
 *   pixel's footprint. It scales the light, so it moves no hue, and it
 *   averages to about 1 over a footprint, so the footprint keeps the
 *   imagery's own colour (the globe's, at the hand-over).
 * - `globe-bands` (C3): per region, the imagery's mean colour per height
 *   band, each imagery pixel paired with the mean height over its own
 *   footprint (the heights the pixel's colour actually integrates), builds
 *   the relief's height ramp. Narrow bands hold few pixels and the
 *   footprint means compress the height range, so neighbouring bands
 *   regress toward each other; the band width is swept (100-800 m).
 *
 * Plus the measuring tools the comparison page reports with: box means on
 * the lab's post grid (summed-area table) and CIE76 colour difference.
 *
 * Dependency-free except the lab's own colour curves and sun (DEC-H3), so
 * it runs under `node --test`. The shader mirrors `detailRatio` and
 * `globeAlbedoColour` (`terrain-material.js`).
 *
 * @see terrain-globe-colour.js.md
 */
import { LUT } from "./terrain-style.js";
import { linearToSrgb, srgbToLinear } from "./terrain-far-field.js";
import { sunLitColour } from "./terrain-sun.js";

/** C1's defaults. */
export const GLOBE_ALBEDO = Object.freeze({
  /** The albedo grid's texels per side over the drawn region (1 km at 256 km). */
  side: 256,
  /** The detail weight a style opens with (the plan's provisional middle). */
  detail: 0.5,
  /** The high-pass ratio's clamp: a ramp can neither black out nor bleach. */
  ratioRange: Object.freeze([0.5, 1.6]),
});

/** C3's defaults. */
export const GLOBE_BANDS = Object.freeze({
  /** The band width a style opens with, metres (swept 100-800). */
  widthM: 300,
  /** The band widths the comparison sweeps, metres. */
  sweepM: Object.freeze([100, 200, 300, 400, 600, 800]),
  minWidthM: 10,
  maxWidthM: 5000,
});

/** Rec. 709 luminance of an sRGB colour (0-1), in linear light. */
export function linearLuminance(srgb) {
  const [r, g, b] = srgb.map(srgbToLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * C1's luminance-only high-pass, as a factor on the light: 1 + `detail` x
 * (fine / coarse - 1), clamped to `GLOBE_ALBEDO.ratioRange`. `fineLum` is
 * the ramp's linear luminance at the fragment, `coarseLum` its mean over
 * the imagery pixel's footprint. 1 for a black or non-finite footprint.
 * RangeError for a weight outside 0-1.
 */
export function detailRatio(fineLum, coarseLum, detail) {
  if (!(detail >= 0 && detail <= 1)) {
    throw new RangeError(`detail must be in 0-1, got ${detail}`);
  }
  if (detail === 0 || !(coarseLum > 0) || !Number.isFinite(fineLum)) return 1;
  const [lo, hi] = GLOBE_ALBEDO.ratioRange;
  return Math.min(hi, Math.max(lo, 1 + detail * (fineLum / coarseLum - 1)));
}

/**
 * C1's colour: the imagery's albedo under the sun term's light, the light
 * scaled by the detail ratio.
 *
 * @param {{ albedo: number[], light: number, fineLum: number,
 *   coarseLum: number, detail: number }} p
 */
export function globeAlbedoColour({ albedo, light, fineLum, coarseLum, detail }) {
  return sunLitColour(albedo, light * detailRatio(fineLum, coarseLum, detail));
}

/**
 * An imagery pixel's footprint on the ground at a latitude, [east-west,
 * north-south] metres: 180 / 2^level / 256 degrees on a sphere of the
 * WGS84 equatorial radius (about 0.3 % from the ellipsoid's own: a box
 * size, not a survey).
 */
export function footprintM(level, latDeg, tileSize = 256) {
  const deg = 180 / 2 ** level / tileSize;
  const m = (deg * Math.PI * 6_378_137) / 180;
  return [m * Math.cos((latDeg * Math.PI) / 180), m];
}

/**
 * The summed-area table of a square post grid (row 0 south), with a zero
 * row and column in front: (side + 1)^2 doubles.
 */
export function summedArea(values, side) {
  const n = side + 1;
  const sat = new Float64Array(n * n);
  for (let r = 0; r < side; r++) {
    let row = 0;
    for (let c = 0; c < side; c++) {
      row += values[r * side + c];
      sat[(r + 1) * n + c + 1] = sat[r * n + c + 1] + row;
    }
  }
  return sat;
}

/**
 * The mean of the posts inside a box (`wx` x `wy` metres centred on ENU
 * `x`, `y`; a post on the edge counts) of a grid `{ side, spacingM,
 * extentM }` (post 0 at -extentM, as the lab's fields), clipped to the
 * grid; null when no post is inside.
 */
export function boxMeanAt(sat, grid, x, y, wx, wy) {
  const { side, spacingM, extentM } = grid;
  const eps = 1e-9;
  const c0 = Math.max(0, Math.ceil((x - wx / 2 + extentM) / spacingM - eps));
  const c1 = Math.min(side - 1, Math.floor((x + wx / 2 + extentM) / spacingM + eps));
  const r0 = Math.max(0, Math.ceil((y - wy / 2 + extentM) / spacingM - eps));
  const r1 = Math.min(side - 1, Math.floor((y + wy / 2 + extentM) / spacingM + eps));
  if (c1 < c0 || r1 < r0) return null;
  const n = side + 1;
  const sum =
    sat[(r1 + 1) * n + c1 + 1] -
    sat[r0 * n + c1 + 1] -
    sat[(r1 + 1) * n + c0] +
    sat[r0 * n + c0];
  return sum / ((c1 - c0 + 1) * (r1 - r0 + 1));
}

const toLinear = (rgb) => rgb.map(srgbToLinear);
const toSrgb = (lin) => lin.map((v) => linearToSrgb(Math.max(0, v)));

/**
 * C3's ramp from imagery samples `{ heightM, rgb }` (each an imagery pixel
 * with the mean height over its footprint, sRGB 0-1): land samples grouped
 * in bands `widthM` wide from 0 m, each band's colour the mean in linear
 * light at its samples' mean height; samples at or below 0 m make `sea`
 * (null when none). Bands with no sample are left out (the ramp
 * interpolates across them). RangeError for a width outside 10-5000 m.
 *
 * @returns {{ widthM: number, bands: { heightM: number, count: number,
 *   rgb: number[] }[], sea: number[] | null }}
 */
export function bandRamp(samples, { widthM }) {
  if (!(widthM >= GLOBE_BANDS.minWidthM && widthM <= GLOBE_BANDS.maxWidthM)) {
    throw new RangeError(`band width must be 10-5000 m, got ${widthM}`);
  }
  const sums = new Map();
  const sea = { n: 0, lin: [0, 0, 0] };
  for (const { heightM, rgb } of samples) {
    if (!Number.isFinite(heightM)) continue;
    const lin = toLinear(rgb);
    if (heightM <= 0) {
      sea.n += 1;
      lin.forEach((v, i) => (sea.lin[i] += v));
      continue;
    }
    const k = Math.floor(heightM / widthM);
    const s = sums.get(k) ?? { n: 0, h: 0, lin: [0, 0, 0] };
    s.n += 1;
    s.h += heightM;
    lin.forEach((v, i) => (s.lin[i] += v));
    sums.set(k, s);
  }
  const bands = [...sums.keys()]
    .sort((a, b) => a - b)
    .map((k) => {
      const s = sums.get(k);
      return {
        heightM: s.h / s.n,
        count: s.n,
        rgb: toSrgb(s.lin.map((v) => v / s.n)),
      };
    });
  return {
    widthM,
    bands,
    sea: sea.n > 0 ? toSrgb(sea.lin.map((v) => v / sea.n)) : null,
  };
}

/**
 * The ramp's colour at a height (sRGB 0-1): between the two bands around
 * it, linear in light by height; the end bands' colours beyond them. Null
 * when the ramp has no land band.
 */
export function bandRampColour(ramp, heightM) {
  const { bands } = ramp;
  if (bands.length === 0) return null;
  if (heightM <= bands[0].heightM) return bands[0].rgb.slice();
  const last = bands[bands.length - 1];
  if (heightM >= last.heightM) return last.rgb.slice();
  let i = 1;
  while (bands[i].heightM < heightM) i += 1;
  const a = bands[i - 1];
  const b = bands[i];
  const t = (heightM - a.heightM) / (b.heightM - a.heightM);
  const la = toLinear(a.rgb);
  const lb = toLinear(b.rgb);
  return toSrgb(la.map((v, c) => v + (lb[c] - v) * t));
}

/**
 * The ramp as RGBA bytes over 0-`maxM`, each texel the ramp at its centre
 * (as `rampLut` writes style A's). A ramp with no land band writes grey.
 */
export function bandRampLut(ramp, { size, maxM } = LUT) {
  const out = new Uint8Array(size * 4);
  for (let i = 0; i < size; i++) {
    const rgb = bandRampColour(ramp, ((i + 0.5) / size) * maxM) ?? [0.5, 0.5, 0.5];
    out.set([...rgb.map((v) => Math.round(v * 255)), 255], i * 4);
  }
  return out;
}

/** sRGB (0-1) to CIELAB (D65). */
function lab(srgb) {
  const [r, g, b] = toLinear(srgb);
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const [fx, fy, fz] = [f(x), f(y), f(z)];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** CIE76 colour difference of two sRGB colours (0-1): about 2.3 is just noticeable. */
export function deltaE76(a, b) {
  const [la, aa, ba] = lab(a);
  const [lb, ab, bb] = lab(b);
  return Math.hypot(la - lb, aa - ab, ba - bb);
}

/**
 * How well a ramp explains samples: the mean and the 95th percentile of
 * the CIE76 difference between each sample's colour and the ramp's at its
 * height (land samples only).
 */
export function rampFitError(ramp, samples) {
  const errors = samples
    .filter((s) => s.heightM > 0 && Number.isFinite(s.heightM))
    .map((s) => deltaE76(s.rgb, bandRampColour(ramp, s.heightM)))
    .sort((a, b) => a - b);
  if (errors.length === 0) return { mean: Number.NaN, p95: Number.NaN, n: 0 };
  return {
    mean: errors.reduce((sum, e) => sum + e, 0) / errors.length,
    p95: errors[Math.min(errors.length - 1, Math.floor(0.95 * errors.length))],
    n: errors.length,
  };
}
