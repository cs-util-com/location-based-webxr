/**
 * The horizon veil: how much of a fixed veil colour the VISIBLE sky shows
 * in a direction. A hazed city fades its far ground toward a veil colour
 * (`AtmosphereHaze.setVeil`); without this the sky right above that ground
 * keeps its own colour, and the two meet in a hard step at the horizon, and
 * at the rim of a ground tile, where the clamped sky below the horizon shows
 * through. The weight is 1 at and below the horizon and falls exponentially
 * with height, so the sky above keeps its own, darker colour. CPU twin and
 * GLSL.
 *
 * @see horizon-veil.ts.md
 */

/**
 * The rise as the shader takes it: the sine of the height, in degrees above
 * the horizon, where the veil has fallen to 1/e. 0 turns the veil off.
 *
 * @throws RangeError for a height outside 0..90 degrees or not finite.
 */
export function horizonVeilRise(riseDeg: number): number {
  if (!(Number.isFinite(riseDeg) && riseDeg >= 0 && riseDeg <= 90)) {
    throw new RangeError(
      `the horizon veil's rise must be in 0..90 degrees, got ${riseDeg}`
    );
  }
  return Math.sin((riseDeg * Math.PI) / 180);
}

/**
 * The veil's weight in a direction whose up component is `dirY` (the sine
 * of its elevation): 1 at and below the horizon, e^(-dirY / rise) above,
 * 0 everywhere for a rise of 0. GLSL twin: `atmHorizonVeilWeight`.
 *
 * @throws RangeError for a `dirY` or `rise` that is not finite.
 */
export function horizonVeilWeight(dirY: number, rise: number): number {
  if (!(Number.isFinite(dirY) && Number.isFinite(rise))) {
    throw new RangeError(
      `the direction and the rise must be finite, got ${dirY}, ${rise}`
    );
  }
  if (rise <= 0) return 0;
  return Math.exp(-Math.max(dirY, 0) / rise);
}

/** The GLSL twin of {@link horizonVeilWeight}. */
export const HORIZON_VEIL_GLSL = /* glsl */ `
float atmHorizonVeilWeight(float dirY, float rise) {
  if (rise <= 0.0) return 0.0;
  return exp(-max(dirY, 0.0) / rise);
}
`;
