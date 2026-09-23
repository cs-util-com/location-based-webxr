/**
 * The package's one GLSL float-literal formatter, for code that interpolates
 * TypeScript constants into shader source (the occluder's depth shade, the
 * atmosphere).
 *
 * THE CONTRACT: always a `.` or an exponent (GLSL ES has no implicit int →
 * float conversion), nine significant digits (small coefficients such as
 * 5.8e-3/km or 1e-9 keep their value), and a RangeError instead of "NaN" or
 * "Infinity" in a shader.
 *
 * Unified 2026-09-23 (DEC-H3): `visualization/occlusion-mesh.ts` had a private
 * `toFixed(4)` copy, which rounded anything below 5e-5 to zero and passed NaN
 * through; the atmosphere needed the stricter form.
 *
 * @see glsl-float.ts.md
 */

/** A JS number as a GLSL float literal. Throws RangeError if not finite. */
export function glslFloat(value: number): string {
  if (!Number.isFinite(value)) {
    throw new RangeError(`cannot write ${value} as a GLSL float`);
  }
  const text = value.toPrecision(9);
  return /[.e]/.test(text) ? text : `${text}.0`;
}
