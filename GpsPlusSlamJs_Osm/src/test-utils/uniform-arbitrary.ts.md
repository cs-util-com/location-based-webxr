# `test-utils/uniform-arbitrary.ts`

## Purpose

Fast-check arbitraries that draw a number uniformly over a range, for the
latitudes, longitudes and bearings of property tests. A copy of
`GpsPlusSlamJs_AppFramework/src/test-utils/uniform-arbitrary.ts`, kept here
because this package does not depend on the framework; the two are held to the
same tests (`uniform-arbitrary.test.ts` in each).

## Public API

- `uniformIn(min, max)` → `fc.Arbitrary<number>` on a 1e-6 grid over
  `[min, max]`. The bounds are rounded inward to the grid. Throws `RangeError`
  for a non-finite or inverted range, or for one that holds no grid point.
- `uniformWithSeams(min, max)` → the same, with one draw in ten taken exactly
  from `min`, `max` and, when the range contains it, `0`.

## Invariants & assumptions

- **Why not `fc.double({ min, max })`.** fast-check spreads `fc.double` evenly
  over the floating-point representations, not over the range, so most draws
  sit within a hair of zero. A property over "any place on Earth" then tested
  one place: a gate width that left no walkable step at some lattice alignments
  passed for months that way. Use `fc.double` only where the edge values near
  zero are what the property is about.
- **Why `fc.noBias` around the integer.** By default `fc.integer` skews its
  draws toward zero and the two bounds: about 18 % of draws over (0, 180) land
  within 1e-3 of an end. Wrapped in `fc.noBias` they are uniform over the grid.
- **Why the seams are a separate helper.** A uniform draw lands on `±180` once
  in about 360 million draws, so it never exercises the antimeridian or a
  bound. `fc.double` used to, by its bias. A property that claims pole or
  antimeridian coverage (`spatial/resolutions.property.test.ts`) uses
  `uniformWithSeams`; one about "any alignment" uses `uniformIn`.
- **Why inward rounding.** Rounding to the nearest grid point could step out of
  the range: `uniformIn(-89.9999996, 89.9999996)` drew `±90`, which h3-js reads
  as the pole.
- The grid is 1e-6 units: for degrees about 0.1 m, far finer than a res-13 H3
  cell, so no alignment the lattice can produce is skipped.
- Test-only, like everything in `test-utils/`: excluded from the production
  typecheck.

## Examples

```ts
fc.property(uniformIn(0, 180), uniformIn(-60, 60), uniformIn(-179, 179),
  (bearing, lat, lng) => { ... });
fc.record({ lat: uniformWithSeams(-89.9, 89.9), lng: uniformWithSeams(-180, 180) });
```

## Tests

`uniform-arbitrary.test.ts` measures the distribution over 20 000 draws (end
bands, sign split), the range and off-grid bounds, the seam share and the
validation. Used by `mesh/barrier-gates.property.test.ts`,
`nav/building-passages.property.test.ts` and `spatial/*.property.test.ts`.
