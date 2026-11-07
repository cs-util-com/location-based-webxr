# `test-utils/uniform-arbitrary.ts`

## Purpose

A fast-check arbitrary that draws a number uniformly over a range, for the
latitudes, longitudes and bearings of property tests.

## Public API

- `uniformIn(min, max)` → `fc.Arbitrary<number>` on a 1e-6 grid over
  `[min, max]`. Throws `RangeError` for a non-finite or inverted range.

## Invariants & assumptions

- **Why not `fc.double({ min, max })`.** fast-check spreads `fc.double` evenly
  over the floating-point representations, not over the range, so most draws
  sit within a hair of zero. A property over "any place on Earth" then tested
  one place: a gate width that left no walkable step at some lattice alignments
  passed for months that way. Use `fc.double` only where the edge values near
  zero are what the property is about.
- The grid is 1e-6 units: for degrees about 0.1 m, far finer than a res-13 H3
  cell, so no alignment the lattice can produce is skipped.
- Test-only, like everything in `test-utils/`: excluded from the production
  typecheck.

## Examples

```ts
fc.property(uniformIn(0, 180), uniformIn(-60, 60), uniformIn(-179, 179),
  (bearing, lat, lng) => { ... });
```

## Tests

Exercised by the property tests that use it (`mesh/barrier-gates.property.test.ts`,
`nav/building-passages.property.test.ts`, `spatial/*.property.test.ts`).
