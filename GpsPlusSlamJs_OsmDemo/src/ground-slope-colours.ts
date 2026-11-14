/**
 * The slope treatment's colours as plain data (colour schemes plan
 * 2026-11-10-0841 section 4.4).
 *
 * A module of its own so the colour-scheme table can name them without
 * importing three.js: the table is read by the worker too, and the shader
 * patch that consumes these (`ground-slope-shader.ts`) builds `Vector3`s.
 *
 * @see ground-slope-colours.ts.md
 */

/** A linear rgb triple, each channel in [0, 1]. */
export type LinearRgb = readonly [number, number, number];

/**
 * The slope treatment's four colours, in LINEAR rgb.
 *
 * They were GLSL literals until the schemes made them a choice. They are kept
 * linear rather than written as sRGB hex so the default reproduces the
 * literals exactly: a hex would be rounded to 8 bits and decoded, and the
 * default look would move by a fraction of a level for no reason.
 */
export interface GroundSlopeColours {
  /** The aspect tint's end for slopes facing away from the sun's side. */
  readonly cool: LinearRgb;
  /** The aspect tint's other end. */
  readonly warm: LinearRgb;
  /** The isoclines. */
  readonly isoline: LinearRgb;
  /** The rim added at grazing angles. */
  readonly rim: LinearRgb;
}

/** Today's colours, the literals the shader carried until the schemes. */
export const DEFAULT_GROUND_SLOPE_COLOURS: GroundSlopeColours =
  Object.freeze<GroundSlopeColours>({
    cool: [0.1, 0.25, 0.35],
    warm: [0.35, 0.2, 0.15],
    isoline: [0.62, 0.74, 0.92],
    rim: [0.2, 0.2, 0.2],
  });

/** The four colours in a fixed order, for loops that must visit all of them. */
function slopeColourList(colours: GroundSlopeColours): readonly LinearRgb[] {
  return [colours.cool, colours.warm, colours.isoline, colours.rim];
}

/**
 * Refuses colours that are not linear rgb in [0, 1]: `RangeError` naming the
 * offending triple. Returns the colours for chaining.
 */
export function validateGroundSlopeColours(
  colours: GroundSlopeColours,
): GroundSlopeColours {
  for (const rgb of slopeColourList(colours)) {
    const fine =
      Array.isArray(rgb) &&
      rgb.length === 3 &&
      rgb.every((c) => Number.isFinite(c) && c >= 0 && c <= 1);
    if (!fine) {
      throw new RangeError(
        `slope colour [${String(rgb)}] is not linear rgb in [0, 1]`,
      );
    }
  }
  return colours;
}
