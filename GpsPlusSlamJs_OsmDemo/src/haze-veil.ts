/**
 * The haze veil (city look): a fixed colour the distance haze fades toward
 * in place of the sky's own colour in that direction. It is stated as the
 * colour a fully hazed distance SHOWS on screen, CIE L*, a* and b*, and
 * converted here to the scene-linear colour that the renderer's tone mapping
 * turns into exactly that, because the haze blends before tone mapping. Not
 * every colour can be shown at every lightness (the tone curve's knee above,
 * the screen's colours below), so the lightness a colour can show is a range
 * of its own (`veilLightnessBounds`), and `clampHazeVeil` holds a veil in it.
 *
 * @see haze-veil.ts.md
 */

import { labToRgb, rgbToLab, srgbToLinear } from "gps-plus-slam-osm";

/** A veil as the light dialog states it: what the screen shows. */
export interface HazeVeil {
  /** CIE L*, 0-100 (above 0; 0 means "no veil" to the light settings). */
  readonly lightness: number;
  /** CIE b*: below 0 is bluer, above 0 yellower. */
  readonly tint: number;
  /** CIE a*: below 0 is greener, above 0 redder; absent means 0. */
  readonly tintA?: number;
  /**
   * How far up the sky the veil reaches, degrees above the horizon where it
   * has fallen to 1/e (the framework's horizon veil); 0 or absent leaves the
   * sky its own colour.
   */
  readonly riseDeg?: number;
}

type Rgb = readonly [number, number, number];

/** The default tint: a slightly blue veil, the far field's reference hue. */
export const HAZE_VEIL_TINT = -4;

/**
 * The default rise: how far up the sky the veil reaches, degrees above the
 * horizon where it has fallen to 1/e (`HazeVeil.riseDeg`).
 */
export const HAZE_VEIL_RISE_DEG = 10;

/** Neutral's compression knee (three's `StartCompression`, 0.8 - 0.04). */
const KNEE = 0.76;
const DESATURATION = 0.15;

/**
 * three's `NeutralToneMapping` (Khronos PBR Neutral), mirrored from its GLSL:
 * the exposure, an offset of 0.04 (a toe of 6.25 x^2 below 0.08), and above
 * the knee a compression that also desaturates. Display-linear out.
 */
export function neutralToneMap(rgb: Rgb, exposure: number): Rgb {
  const c = rgb.map((v) => v * exposure);
  const x = Math.min(c[0]!, c[1]!, c[2]!);
  const offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
  const y = c.map((v) => v - offset);
  const peak = Math.max(y[0]!, y[1]!, y[2]!);
  if (peak < KNEE) return [y[0]!, y[1]!, y[2]!];
  const d = 1 - KNEE;
  const newPeak = 1 - (d * d) / (peak + d - KNEE);
  const g = 1 - 1 / (DESATURATION * (peak - newPeak) + 1);
  const out = y.map((v) => {
    const scaled = (v * newPeak) / peak;
    return scaled + (newPeak - scaled) * g;
  });
  return [out[0]!, out[1]!, out[2]!];
}

/**
 * The display-linear colour a veil shows: its L*a*b* through the nearest
 * 8-bit sRGB colour, then linearised. Also the fallback sky's fog colour,
 * whose stock fog blends after tone mapping.
 */
export function veilDisplayLinear(veil: HazeVeil): Rgb {
  return hexDisplayLinear(
    labToRgb({ l: veil.lightness, a: veil.tintA ?? 0, b: veil.tint }),
  );
}

function hexDisplayLinear(hex: number): Rgb {
  return [
    srgbToLinear(((hex >> 16) & 0xff) / 255),
    srgbToLinear(((hex >> 8) & 0xff) / 255),
    srgbToLinear((hex & 0xff) / 255),
  ];
}

/**
 * The largest CIE76 Delta E between the colour a veil asks for and what the
 * screen shows (8-bit sRGB) at any lightness its colour can show, from L* 3
 * up (`haze-veil.test.ts` holds it over every slider colour).
 */
export const VEIL_DELTA_E_TOLERANCE = 1;

/** The lightness grid the bounds are found on, L* units. */
const BOUND_GRID = 0.1;

/**
 * Whether the screen can show this colour through the inverse tone map: its
 * nearest 8-bit sRGB colour (out-of-gamut channels clipped) is within
 * `VEIL_DELTA_E_TOLERANCE` of it, so a clipped colour is refused, and that
 * colour's brightest display channel is below the knee.
 */
function showable(l: number, a: number, b: number): boolean {
  const hex = labToRgb({ l, a, b });
  const got = rgbToLab(hex);
  if (Math.hypot(got.l - l, got.a - a, got.b - b) >= VEIL_DELTA_E_TOLERANCE) {
    return false;
  }
  return Math.max(...hexDisplayLinear(hex)) < KNEE;
}

type Bounds = { readonly min: number; readonly max: number };

/** Bounds per colour (a pure function of it); cleared when it grows large. */
const boundsCache = new Map<string, Bounds | null>();
const BOUNDS_CACHE_SIZE = 4096;

/**
 * The lightnesses a veil of this colour (a*, b*) can show: `{ min, max }`
 * on a 0.1 grid of L* in (0, 100], or null when it can show none. `max` is
 * the brightest showable lightness (above it the colour reaches the tone
 * curve's knee or leaves the gamut), and `min` the bottom of the unbroken
 * run of showable lightnesses below it (below it the colour leaves the
 * gamut, or its 8-bit rounding passes the tolerance), so every lightness in
 * between is shown as asked. Neutral reaches about L* 89.7; a strong
 * yellow or blue far less.
 */
export function veilLightnessBounds(
  tintA: number,
  tint: number,
): Bounds | null {
  if (!(Number.isFinite(tintA) && Number.isFinite(tint))) return null;
  const key = `${tintA},${tint}`;
  const cached = boundsCache.get(key);
  if (cached !== undefined) return cached;
  const at = (k: number) => Number((k * BOUND_GRID).toFixed(1));
  let k = Math.round(100 / BOUND_GRID);
  while (k >= 1 && !showable(at(k), tintA, tint)) k--;
  let bounds: Bounds | null = null;
  if (k >= 1) {
    const max = at(k);
    while (k > 1 && showable(at(k - 1), tintA, tint)) k--;
    bounds = { min: at(k), max };
  }
  if (boundsCache.size >= BOUNDS_CACHE_SIZE) boundsCache.clear();
  boundsCache.set(key, bounds);
  return bounds;
}

/**
 * The veil with its lightness held inside the lightnesses its colour can
 * show (`veilLightnessBounds`); its colour (a*, b*) and rise are kept. A veil
 * shown as it is is returned as it is. The bounds hold on their 0.1 grid,
 * and between two grid points the 8-bit rounding can still miss (a link may
 * state L* to 3 decimals; it happens near the bottom of a run), so a
 * lightness inside the run that is not shown exactly goes to its nearest
 * grid point, which is.
 *
 * @throws RangeError for a colour no lightness can show.
 */
export function clampHazeVeil(veil: HazeVeil): HazeVeil {
  const bounds = veilLightnessBounds(veil.tintA ?? 0, veil.tint);
  if (bounds === null) {
    throw new RangeError(
      `no lightness can show a veil of a* ${veil.tintA ?? 0} b* ${veil.tint}`,
    );
  }
  const tintA = veil.tintA ?? 0;
  const inRun = Math.min(Math.max(veil.lightness, bounds.min), bounds.max);
  const lightness = showable(inRun, tintA, veil.tint)
    ? inRun
    : Math.min(Math.max(Number(inRun.toFixed(1)), bounds.min), bounds.max);
  return lightness === veil.lightness ? veil : { ...veil, lightness };
}

function assertVeil(veil: HazeVeil, exposure: number): void {
  const { lightness, tint, tintA = 0 } = veil;
  if (!(Number.isFinite(lightness) && lightness > 0 && lightness <= 100)) {
    throw new RangeError(
      `veil lightness must be in (0, 100], got ${lightness}`,
    );
  }
  if (!(Number.isFinite(tint) && Number.isFinite(tintA))) {
    throw new RangeError(
      `veil tints must be finite, got a* ${tintA} b* ${tint}`,
    );
  }
  if (!(Number.isFinite(exposure) && exposure > 0)) {
    throw new RangeError(
      `exposure must be positive and finite, got ${exposure}`,
    );
  }
}

/**
 * The scene-linear colour that {@link neutralToneMap} at `exposure` turns
 * into the veil's display colour: the curve's exact inverse below its knee.
 * One offset serves all three channels (Neutral subtracts the same offset
 * from each), found from the darkest channel.
 *
 * @throws RangeError for a lightness outside (0, 100], a non-finite tint, an
 *   exposure that is not positive and finite, or a colour the screen cannot
 *   show exactly: its brightest channel reaches the compression knee (no
 *   exact inverse there), or it lies outside the sRGB gamut
 *   (`clampHazeVeil` holds a veil where neither happens).
 */
export function veilSceneColour(veil: HazeVeil, exposure: number): Rgb {
  assertVeil(veil, exposure);
  if (!showable(veil.lightness, veil.tintA ?? 0, veil.tint)) {
    throw new RangeError(
      `veil L* ${veil.lightness} a* ${veil.tintA ?? 0} b* ${veil.tint} ` +
        "is above the tone curve's knee or outside the screen's colours",
    );
  }
  const y = veilDisplayLinear(veil);
  const yMin = Math.min(...y);
  // The darkest channel shows which branch of the offset it went through.
  const xMin = Math.sqrt(yMin / 6.25);
  const offset = yMin >= 0.04 ? 0.04 : xMin - 6.25 * xMin * xMin;
  return [
    (y[0] + offset) / exposure,
    (y[1] + offset) / exposure,
    (y[2] + offset) / exposure,
  ];
}
