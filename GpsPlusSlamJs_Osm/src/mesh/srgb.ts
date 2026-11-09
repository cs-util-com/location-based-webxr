/**
 * The sRGB transfer curve, one channel at a time, 0 to 1 both ways.
 *
 * The city's palettes are sRGB (what a person picks on a screen) and three.js
 * shades in linear light, so every colour crosses this curve once on its way
 * to a vertex buffer. Mixing two colours is also done in linear light, the
 * way `THREE.Color.lerp` does it, or a half mix of white and black draws
 * 0x80 instead of 0xbc.
 *
 * @see srgb.ts.md
 */

/** Clamps to 0..1; NaN and infinities read as 0. */
function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** sRGB channel to linear light, both 0 to 1. */
export function srgbToLinear(v: number): number {
  const c = clamp01(v);
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Linear light to an sRGB channel, both 0 to 1. */
export function linearToSrgb(v: number): number {
  const c = clamp01(v);
  return c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
}
