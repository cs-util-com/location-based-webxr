/**
 * The globe atmosphere's numbers and its frame (round-4 plan 2026-09-28-2105
 * DEC-GL4-4), kept free of imports so they are unit-tested under Node.
 *
 * @see globe-atmosphere-frame.js.md
 */

/**
 * The pass's look defaults (lab hash keys `atmoSteps`, `atmoStrength`,
 * `atmoThickness`) and their ranges:
 * - `steps`: samples per ray (2-64), a shader constant. 12 from the round-4
 *   sweep of 6-24 against a 64-sample reference: no count showed a ring
 *   (extra step at most 1.6 levels), the error against 64 flattens from
 *   12 on (limb 10.9 / 10.1 / 10.1 at 12 / 16 / 24, radial 5.4 / 4.6 /
 *   5.1), and 16 costs 15-40 % more frame time than 12.
 * - `strength`: a scale on the physical light (0-4), 1 = as computed for
 *   the scene's sun.
 * - `thickness`: how many times thicker than the real air the shell is
 *   drawn (1-10), at the SAME optical depth, so the colours stay physical
 *   and only the band and the halo widen. 1 = the real 100 km. 6 by
 *   default (owner decision DEC-GL4-11: as wide as the reference image,
 *   the slider back down to physical): a 600 km shell, about the depth of
 *   the reference's bright inner band (10 % of the radius); the halo then
 *   fades to 12 levels by 300 km out, against 0 by 150 km at 1.
 * - `visibilityKm`: the air's clarity for the aerosol density, the
 *   framework's own default (60 km).
 */
export const GLOBE_ATMOSPHERE = {
  steps: 12,
  strength: 1,
  thickness: 6,
  visibilityKm: 60,
};

const RANGES = {
  steps: [2, 64],
  strength: [0, 4],
  thickness: [1, 10],
};

/**
 * The look, each value from `input` or the default, the steps rounded.
 * RangeError for a value outside its range or not a finite number (the
 * steps become a loop bound in the shader, so a bad one must not reach it).
 */
export function atmosphereLook(input) {
  const look = {};
  for (const key of Object.keys(RANGES)) {
    const raw = input[key] ?? GLOBE_ATMOSPHERE[key];
    const value = key === "steps" ? Math.round(raw) : raw;
    const [min, max] = RANGES[key];
    if (!(Number.isFinite(value) && value >= min && value <= max)) {
      throw new RangeError(
        `atmosphere ${key} must be ${min}-${max}, got ${raw}`,
      );
    }
    look[key] = value;
  }
  return look;
}

/**
 * Per-axis factors from ECEF metres to the model's frame in km, in which
 * the ellipsoid (radii `[a, b, c]` in metres) IS the model's ground sphere
 * of `groundKm`: x by groundKm / a, y by groundKm / b, z by groundKm / c.
 * An affine map keeps rays straight, so the pass can intersect spheres
 * analytically; the lengths it distorts differ by the flattening (0.34 %),
 * far below the look's tolerance. RangeError for a radius that is not a
 * positive finite number.
 */
export function ellipsoidToModel([a, b, c], groundKm) {
  for (const r of [a, b, c, groundKm]) {
    if (!(r > 0 && Number.isFinite(r))) {
      throw new RangeError(
        `ellipsoid radii and ground must be positive, got ${[a, b, c]}, ${groundKm}`,
      );
    }
  }
  return [groundKm / a, groundKm / b, groundKm / c];
}
