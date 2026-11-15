# colour-scheme-looks.ts

## Purpose

The ten colour schemes beside today's look: the nine of the colour schemes
plan (`GpsPlusSlamJs_Docs/docs/2026-11-10-0841-osm-demo-colour-schemes-plan.md`,
section 4.5, D5) and `URBAN`, the real-albedo grey ladder of the city look
exploration of 2026-11-15 (direction A). They are drafts, rated on the phone through
the `#colour-scheme` dropdown and the session tunes them. `colour-schemes.ts`
puts them into the table after `today`.

## Public API

- `ARCHITECT`, `BLUEPRINT`, `MEDITERRANEAN`, `NORDIC`, `PASTEL`, `MAP`,
  `NIGHT`, `MONO`, `CONTRAST`, `URBAN`: one `ColourScheme` each (label, city colours,
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
- Colour tags (D7): `URBAN` honours the tags but colours roads by class
  (one asphalt family). `MEDITERRANEAN` and `NORDIC` honour `building:colour`,
  `roof:colour` and barrier colour tags and colour roads by surface, like
  today; the seven stylised schemes paint over the tags and colour roads by
  class only (`roadsBySurface: false`), and set every surface to the minor
  road colour so a stray surface read cannot leak today's colours in.
- The slope treatment keeps the default colours in every scheme (no scheme
  retunes it yet); the plates are each scheme's own and lighter than its
  ground.
- Trims: `NIGHT` 1.4 (reads at noon), `ARCHITECT` 0.9 (no glare), `URBAN`
  1.6 (its walls' mean reflectance is about 0.25 against today's 0.59), the
  rest 1.
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
contrast 39.0; urban (2026-11-15) 13.1 (walls 55.2, car roads 12.3, ground
42.1).

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

- `colour-schemes.test.ts`: the ten in plan order then `urban`, the urban
  ladder's hex proxy (walls mean L* 53-57 spanning at least 30, car roads
  10-14, ground 40-44) and its flags, validation, the lightness
  distance, plates lighter than the ground, the tag rule, only the default on
  today's city colours, the two trims.
- `colour-schemes.property.test.ts`: every name resolves from a link to
  itself; every scheme has every road and land-use class.
- `playwright-tests/scene-3d.spec.js` ("the colour schemes"): the switch
  repaints, says Applying until the echo, writes and boots the link.

## Zebra paint (`markings`, city objects M4b, 2026-11-11)

Every scheme names its zebra paint in `roadsOf` (`RoadTones.markings`): a
near-white on light and dark streets, a dark ink in blueprint, map and
pastel, where the streets are light. `colour-schemes.test.ts` holds the paint
at least 15 L* from every car-road colour the scheme can draw (class, and
surface where `roadsBySurface`). Measured distances: today 16.4 (its paint is lighter than O3's 0xd6d3ca,
which sat 5.5 from the light motorway grey), architect
18.6, blueprint 58.2, mediterranean 19.4, nordic 18.8, pastel 20.0, map 25.5,
night 18.6, mono 23.0, contrast 75.6. Swept: a floor of 10 or 15 passes all
ten; 20 fails today, architect, mediterranean, nordic and night (pastel sits
on it);
25 fails mono and pastel as well. A hex proxy: paint and roads both render
raw, but fog and the light are not in it.

## Urban greys (`URBAN`, 2026-11-15)

A value ladder at real facade albedos (limestone and cream, sand, light
concrete, granite, cool blue-grey, brick and salmon, brownstone, dark stone
or glass; 20 walls, L* 34-76, mean chroma about 8, 5 of 20 warm), bitumen,
gravel and membrane flat roofs, slate, muted clay and zinc pitched roofs, one
aged-asphalt family for the car roads (L* 11-14) and a neutral ground (L*
42). Paint distance to the darkest street: 69 L*. Values the verdict rests on,
to be swept on the rendered look rather than here: the trim (1.6; above
about 2 the roads blow out, they take the trim too), the ladder's depth (if
it reads dirty, shift it up 6-8 L* before trimming further), the warm share
(25%; 10-40%) and the cream chroma (8-13).

### Height, use and material aware (direction B, 2026-11-15)

- `towerWalls`: glass blue-grey `0x566066`, `0x676e73`, `0x4b5056`; dark
  stone `0x6a6865`, `0x75777a`; light limestone `0xb1aaa0`, `0x9d9b96`;
  steel grey `0x838789`, drawn by every building of `towerFromM` = 40 m or
  more. The glass and dark-stone tones sit 4 L* above the exploration's
  draft (hue and chroma kept), so the tower group's mean stays 8 L* clear
  of the ground (`colour-schemes.test.ts`). That check is a MEAN-ONLY
  PROXY: a tower draws one tone of the list by its seed, so a single tone
  near the ground (glass `0x566066` is 2 L* from it) is one tower in
  several, not every tower; the rendered look is the judge.
- `honourMaterialTags` with `materialWalls`: glass `0x454f55`, brick
  `0x977165`, concrete `0x979692`, stone `0xb3aa9d`, sandstone `0xb39c87`,
  granite `0x817b78`, metal `0x888c8e`, plaster `0xbeb5a7`, wood
  `0x8f7462`, each at or near its real albedo; a colour tag still wins, a
  material beats the height. A material building draws its ONE tone on
  every wall, so each tone is held 8 L* from the ground and the roads ON
  ITS OWN, not by a mean. Three were moved in L* for it, hue and chroma
  kept in Lab: glass from L* 40 (the exploration's 36 was too close as
  well) down to 33, 9 below the ground; brick (48) and wood (46) up to
  51, the low end of the brick and salmon facades lit in the reference
  (L* 49-69), where real brick albedo alone (L* 38-47) would sit on the
  ground.
- `wallJitterL` 3: every wall shifted by a seeded amount of up to 3 L*.
- The rules live in the library (`building-palette.ts`); the default has
  them off. Values to sweep on the rendered look: `towerFromM` 25-60 m (at
  25 m low walk-ups start to draw tower tones) and the jitter.
- Tested in `colour-schemes.test.ts` ("tells towers from walk-ups ...").
