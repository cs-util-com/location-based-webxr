# `test-utils/uniform-arbitrary.ts`

## Purpose

Test-only fast-check arbitraries that draw a number uniformly over a range, for
the latitudes, longitudes, bearings and offsets of property tests. Shared by the
framework and every package that depends on it, deep-imported as
`gps-plus-slam-app-framework/test-utils/uniform-arbitrary` (never through a
barrel).

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
  one place: a gate width in the OSM package that left no walkable step at some
  lattice alignments passed for months that way. Use `fc.double` only where the
  edge values near zero are what the property is about.
- **Why `fc.noBias` around the integer.** By default `fc.integer` skews its
  draws toward zero and the two bounds: about 18 % of draws over (0, 180) land
  within 1e-3 of an end. Wrapped in `fc.noBias` they are uniform over the grid.
- **Why the seams are a separate helper.** A uniform draw lands on `±180` once
  in about 360 million draws, so it never exercises the antimeridian or a
  bound. `fc.double` used to, by its bias. A property that claims pole or
  antimeridian coverage uses `uniformWithSeams`; one about "any alignment" uses
  `uniformIn`.
- **Why inward rounding.** Rounding to the nearest grid point could step out of
  the range: `uniformIn(-89.9999996, 89.9999996)` drew `±90`, which h3-js reads
  as the pole.
- The grid is 1e-6 units: for degrees about 0.1 m, far finer than a res-13 H3
  cell, so no alignment the lattice can produce is skipped.
- `fast-check` is an optional peer of the framework and stays external in the
  build, so the consumer's copy is used.

## Examples

```ts
import { uniformIn, uniformWithSeams } from 'gps-plus-slam-app-framework/test-utils/uniform-arbitrary';

const latLng = fc.record({ lat: uniformWithSeams(-89.9, 89.9), lng: uniformWithSeams(-180, 180) });
fc.property(uniformIn(0, 180), latLng, (bearing, { lat, lng }) => { ... });
```

## Tests

`uniform-arbitrary.test.ts` measures the distribution over 20 000 draws (end
bands, sign split), the range and off-grid bounds, the seam share and the
validation. Used by the property tests of the framework (`geo/h3-coverage`),
the RecorderApp (`ui/map-browser-index`), the Tour Viewer
(`editor3d/globe-layer`) and the OSM demo (`quest-beacon-placement`,
`ar-fused-gps`). The OSM package keeps its own copy, `GpsPlusSlamJs_Osm/src/test-utils/uniform-arbitrary.ts`,
because it does not depend on the framework.
