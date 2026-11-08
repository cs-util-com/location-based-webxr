/**
 * A number drawn UNIFORMLY over a range, for latitudes, longitudes and bearings
 * in property tests. The OSM package cannot depend on the app framework, so it
 * keeps this copy of `gps-plus-slam-app-framework/test-utils/uniform-arbitrary`.
 *
 * Not `fc.double`, whose values are spread evenly over the floating-point
 * representations rather than over the range: about 91 % of its draws over
 * `[-60, 60]` land within 1e-6 of zero, so a property over "any place, any
 * bearing" sampled essentially one spot on the H3 lattice, due north.
 *
 * @see uniform-arbitrary.ts.md
 */

import fc from "fast-check";

/** The grid the values sit on, in units of the range: 1e-6. */
const STEPS_PER_UNIT = 1e6;

/**
 * A value on a micro-unit grid, uniform over `[min, max]`. For degrees the grid
 * is about 0.1 m, far finer than a res-13 cell. The bounds are rounded INWARD
 * to the grid, so no draw ever leaves the range.
 *
 * @throws RangeError for a non-finite or inverted range, or one that holds no
 *   grid point.
 */
export function uniformIn(min: number, max: number): fc.Arbitrary<number> {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) {
    throw new RangeError(`uniformIn: bad range [${min}, ${max}]`);
  }
  const low = Math.ceil(min * STEPS_PER_UNIT);
  const high = Math.floor(max * STEPS_PER_UNIT);
  if (low > high) {
    throw new RangeError(`uniformIn: no grid point in [${min}, ${max}]`);
  }
  // noBias: by default fast-check skews integers toward zero and the bounds.
  return fc
    .noBias(fc.integer({ min: low, max: high }))
    .map((micro) => micro / STEPS_PER_UNIT);
}

/**
 * `uniformIn(min, max)` with the seams mixed back in: one draw in ten is
 * exactly `min`, `max` or (when the range holds it) `0`. For properties that
 * claim coverage of the poles or the antimeridian, which a uniform draw
 * practically never lands on.
 */
export function uniformWithSeams(
  min: number,
  max: number,
): fc.Arbitrary<number> {
  const seams = [...new Set([min, max, ...(min <= 0 && 0 <= max ? [0] : [])])];
  return fc.oneof(
    { weight: 9, arbitrary: uniformIn(min, max) },
    { weight: 1, arbitrary: fc.constantFrom(...seams) },
  );
}
