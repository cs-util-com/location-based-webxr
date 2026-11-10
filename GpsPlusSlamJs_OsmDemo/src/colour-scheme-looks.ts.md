# colour-scheme-looks.ts

## Purpose

The nine colour schemes beside today's look (colour schemes plan
`GpsPlusSlamJs_Docs/docs/2026-11-10-0841-osm-demo-colour-schemes-plan.md`,
section 4.5, D5). They are drafts: the owner rates them on the phone through
the `#colour-scheme` dropdown and the session tunes them. `colour-schemes.ts`
puts them into the table after `today`.

## Public API

- `ARCHITECT`, `BLUEPRINT`, `MEDITERRANEAN`, `NORDIC`, `PASTEL`, `MAP`,
  `NIGHT`, `MONO`, `CONTRAST`: one `ColourScheme` each (label, city colours,
  ground colours, brightness trim). Nothing else is exported; read them
  through `COLOUR_SCHEMES` in `colour-schemes.ts`.

## Invariants and assumptions

- Every scheme is `{ ...DEFAULT_CITY_COLOUR_SCHEME, overrides }`, so a field
  nobody overrides stays today's.
- **Every map is the default's map with its values replaced** (`recolour`).
  The library's `validateCityColourScheme` refuses a missing or an unknown
  key, so a hand-written list would break the moment the default gains a road
  class or a land-use class; rebuilding from the default's keys cannot.
- Road classes are grouped by the role a map gives them: major (motorway,
  trunk, primary and their links), middle (secondary, tertiary), paths
  (pedestrian, footway, path, steps, cycleway, platform, track, bridleway),
  and minor (everything else). `primary` may take its own colour (the map).
- Colour tags (D7): `MEDITERRANEAN` and `NORDIC` honour `building:colour`,
  `roof:colour` and barrier colour tags and colour roads by surface, like
  today; the seven stylised schemes paint over the tags and colour roads by
  class only (`roadsBySurface: false`), and set every surface to the minor
  road colour so a stray surface read cannot leak today's colours in.
- The slope treatment keeps the default colours in every scheme (no scheme
  retunes it yet); the plates are each scheme's own and lighter than its
  ground.
- Trims: `NIGHT` 1.4 (reads at noon), `ARCHITECT` 0.9 (no glare), the rest 1.
- `CONTRAST` keeps its hues on the blue-orange axis, which the common
  red-green deficiencies keep apart, and separates vegetation from the ground
  by lightness rather than by hue alone.
- The module imports only the library and `ground-slope-colours.ts` (no
  three.js): the worker reads it.

## The lightness check and its sweep

`colour-schemes.test.ts` demands that buildings (the mean CIE L* of the wall
tones), roads (the mean L* of the car road classes) and the ground keep a
least pairwise distance of `MIN_LIGHTNESS_DISTANCE` = 8 L* units. Measured
least distances (2026-11-10): today 9.3, architect 9.8, blueprint 14.5,
mediterranean 10.0, nordic 11.9, pastel 9.7, map 9.1, night 19.9, mono 14.4,
contrast 39.0.

- Swept over floors 4, 6, 8, 9: every scheme passes.
- At 10: today, architect, pastel and map fail; at 12 also mediterranean and
  nordic.
- **What reverses the verdict:** a floor above 9.1 fails the map; above 9.3
  it fails today's look itself, so no floor above that can be a rule.
- Parameters the check rests on: walls stand for the buildings (roofs are
  not counted); road classes are weighted by count, not by length on the
  ground; the two surface-coloured schemes are judged by their class colours,
  while on the ground their roads mostly take today's surface colours (L*
  about 65-75), which this check does not see.

## Examples

```ts
import { COLOUR_SCHEMES } from "./colour-schemes.js";
COLOUR_SCHEMES.night.brightnessTrim; // 1.4
COLOUR_SCHEMES.map.city.roads.get("primary"); // 0xf2a65a
```

## Tests

- `colour-schemes.test.ts`: the ten in plan order, validation, the lightness
  distance, plates lighter than the ground, the tag rule, only the default on
  today's city colours, the two trims.
- `colour-schemes.property.test.ts`: every name resolves from a link to
  itself; every scheme has every road and land-use class.
- `playwright-tests/scene-3d.spec.js` ("the colour schemes"): the switch
  repaints, says Applying until the echo, writes and boots the link.
