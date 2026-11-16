/**
 * The haze veil (city look): a fixed colour the distance haze fades toward
 * in place of the sky's own colour in that direction. It is stated as the
 * colour a fully hazed distance SHOWS on screen, CIE L* and b* (a* 0), and
 * converted here to the scene-linear colour that the renderer's tone mapping
 * turns into exactly that, because the haze blends before tone mapping.
 *
 * @see haze-veil.ts.md
 */

import { labToRgb, srgbToLinear } from "gps-plus-slam-osm";

/** A veil as the light dialog states it: what the screen shows. */
export interface HazeVeil {
  /** CIE L*, 0-100 (above 0; 0 means "no veil" to the light settings). */
  readonly lightness: number;
  /** CIE b*: below 0 is bluer, above 0 warmer. */
  readonly tint: number;
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
export const HAZE_VEIL_RISE_DEG = 4;

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
  const hex = labToRgb({ l: veil.lightness, a: 0, b: veil.tint });
  return [
    srgbToLinear(((hex >> 16) & 0xff) / 255),
    srgbToLinear(((hex >> 8) & 0xff) / 255),
    srgbToLinear((hex & 0xff) / 255),
  ];
}

function assertVeil(veil: HazeVeil, exposure: number): void {
  const { lightness, tint } = veil;
  if (!(Number.isFinite(lightness) && lightness > 0 && lightness <= 100)) {
    throw new RangeError(
      `veil lightness must be in (0, 100], got ${lightness}`,
    );
  }
  if (!Number.isFinite(tint)) {
    throw new RangeError(`veil tint must be finite, got ${tint}`);
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
 *   exposure that is not positive and finite, or a colour whose brightest
 *   channel reaches the compression knee (no exact inverse there).
 */
export function veilSceneColour(veil: HazeVeil, exposure: number): Rgb {
  assertVeil(veil, exposure);
  const y = veilDisplayLinear(veil);
  if (Math.max(...y) >= KNEE) {
    throw new RangeError(
      `veil L* ${veil.lightness} b* ${veil.tint} is above the tone curve's knee`,
    );
  }
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
