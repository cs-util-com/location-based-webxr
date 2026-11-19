# `test-utils/rule-looks.ts`

## Purpose

Colour looks for the looks build's tests and bench (`CityOptions.looks`):
each switches a different set of the colour rules a scheme can switch, with
every colour table moved, so a looks build is exercised on the expensive
rules rather than on tone shifts alone.

## Public API

- `ruleLook(delta, {walls, towers, roofs}, {honourColourTags, roadsBySurface, honourMaterialTags, towerFromM, wallJitterL}) -> CityColourScheme`
  - the default scheme with every map and colour xor-ed by `delta`, tone
    lists of the given lengths, five material walls and the given rules.
- `DUSK_LIKE` - colour tags ignored, material walls, a 25 m tower rule, a
  6 L* jitter.
- `FOUR_LOOKS` - the default, then an urban-like look (material walls, a
  40 m tower rule, a 3 L* jitter), `DUSK_LIKE`, and a blue-hour-like look
  (roads by surface, no tower rule, no jitter).

## Invariants & assumptions

- Every look passes `validateCityColourScheme` (`delta` stays inside
  0..0x3f3f3f in the property test, so no colour leaves 0..0xffffff).
- Test-only: excluded from the package build (`tsconfig.app.json`).

## Tests

- Used by `mesh/city-looks.property.test.ts` (each look of a looks build
  equals its fixed build) and `mesh/city-looks.bench.ts` (the cost of
  looks at the demo's full pass).
