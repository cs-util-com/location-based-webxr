# `colour-schemes.ts`

## Purpose

The OSM demo's colour schemes (colour schemes plan 2026-11-10-0841): one
frozen table of looks, read by the page (ground, plates, brightness trim, the
dropdown) and by the worker (the city's colours). Light stays with the light
dialog (D4).

## Public API

- `ColourScheme` - `{label, city: CityColourScheme, ground: GroundColours, brightnessTrim}`.
  - `GroundColours` - `{slope: GroundSlopeColours (linear), plates: 0xrrggbb}`.
  - `brightnessTrim` in `MIN_BRIGHTNESS_TRIM` (0.5) .. `MAX_BRIGHTNESS_TRIM` (2).
- `COLOUR_SCHEMES` - the table, in dropdown order: `today`, then the nine
  looks of `colour-scheme-looks.ts` (architect, blueprint, mediterranean,
  nordic, pastel, map, night, mono, contrast); `ColourSchemeName` its keys;
  `COLOUR_SCHEME_NAMES`; `DEFAULT_COLOUR_SCHEME` (`"today"`).
- `validateColourScheme(scheme)` - `TypeError` (no label, malformed city
  scheme via the library's `validateCityColourScheme`) or `RangeError`
  (slope colour, plates colour, trim); returns its input.
- `isColourSchemeName(value)` - own keys only (`toString` is not a scheme).
- `colourSchemeOf(name | undefined)` - the entry; unknown or absent gives the
  default's.
- `resolveColourScheme(name | null, warn?)` - a link's `?scheme=`: absent gives
  the default silently, unknown gives the default with one warning (the
  `?grade=` rule of `globe-grade.ts`).
- `colourSchemeBuildFailure(scheme, cause)` / `failedColourSchemeOf(message)` -
  the worker's error for a city build that failed in a scheme, and its reader.

## Invariants & assumptions

- The default entry IS today's look by reference: `DEFAULT_CITY_COLOUR_SCHEME`,
  `DEFAULT_GROUND_SLOPE_COLOURS`, `PLATE_COLOUR`, trim 1 (D8).
- Every entry is validated when the module loads; a broken one fails every
  importer at once.
- The NAME crosses the worker boundary, never the scheme: small, part of the
  build key, and the worker cannot be handed an unvalidated scheme.
- The page applies the colours of the scheme a mesh was BUILT in
  (`TransferableMesh.colourScheme`), not the choice: the ground never changes
  before its buildings, and AR (default build, D9) gets the default page
  colours without a rule of its own.
- No three.js import (the worker reads this module).

## Examples

```ts
const name = resolveColourScheme(
  new URLSearchParams(location.search).get("scheme"),
);
const look = colourSchemeOf(mesh.colourScheme);
buildingView.setGroundColours(look.city.ground, look.ground.slope);
```

## Tests

- `colour-schemes.test.ts` - the default by reference, every entry validates,
  each refusal, own-key names, link resolution with one warning, the
  build-failure round trip.
- `colour-schemes.property.test.ts` - any link value resolves into the table;
  the failure message reads back any scheme name whatever the cause; every
  name resolves to itself silently; every scheme has every road and land-use
  class.
