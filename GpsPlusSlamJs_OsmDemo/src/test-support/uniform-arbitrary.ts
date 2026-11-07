/**
 * A number drawn UNIFORMLY over a range, for latitudes, longitudes and offsets
 * in property tests.
 *
 * Not `fc.double`, whose values are spread evenly over the floating-point
 * representations rather than over the range: about 91 % of its draws over
 * `[-60, 60]` land within 1e-6 of zero, so a property over "any place, any
 * bearing" sampled essentially one spot.
 *
 * @see uniform-arbitrary.ts.md
 */

import fc from "fast-check";

/**
 * A value on a micro-unit grid, uniform over `[min, max]`. For degrees the grid
 * is ~0.1 m, far finer than a res-13 cell.
 */
export function uniformIn(min: number, max: number): fc.Arbitrary<number> {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) {
    throw new RangeError(`uniformIn: bad range [${min}, ${max}]`);
  }
  return fc
    .integer({ min: Math.round(min * 1e6), max: Math.round(max * 1e6) })
    .map((micro) => micro / 1e6);
}
