/**
 * The sky balance: a colour cast on the sky's own light, named as the CIE
 * a* and b* a mid-grey takes through it (`skyBalanceGain`). The physical
 * twilight sky reads mauve; a look that wants it slate blue sets a cast
 * toward green-blue, and the framework multiplies the sky's radiance by the
 * gain (`SkyAtmosphere.setSkyBalance`, `AtmosphereHaze.setSkyBalance`).
 *
 * @see sky-balance.ts.md
 */

import { veilDisplayLinear } from "./haze-veil.js";

type Rgb = readonly [number, number, number];

/** The lightness the cast is defined at (a mid grey). */
const MID_LIGHTNESS = 50;

/**
 * Whether a* and b* set a balance: either is not 0 (-0 is 0). The one test
 * for "a balance is set", shared by the gain and the Copy line. A value
 * that is not finite counts as set, so a caller deciding on it never
 * meets the gain's RangeError.
 */
export function hasSkyBalance(a: number, b: number): boolean {
  return a !== 0 || b !== 0;
}

/**
 * The per-channel linear gain that casts a mid grey toward Lab(50, a, b),
 * scaled to luminance 1 so only the colour moves; null for (0, 0), no
 * balance. Channels are at least 0 for the sliders' range (a in -20..20,
 * b in -30..30).
 *
 * @throws RangeError for an a* or b* that is not finite.
 */
export function skyBalanceGain(a: number, b: number): Rgb | null {
  if (!(Number.isFinite(a) && Number.isFinite(b))) {
    throw new RangeError(`sky balance must be finite, got a* ${a}, b* ${b}`);
  }
  if (!hasSkyBalance(a, b)) return null;
  const [r, g, bl] = veilDisplayLinear({
    lightness: MID_LIGHTNESS,
    tintA: a,
    tint: b,
  });
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  return [r / y, g / y, bl / y];
}
