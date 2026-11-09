# `mesh/feature-colours.ts` — what colour a building or a road is

## Purpose

Turns OSM tags into a muted material colour for buildings and roads, so the
scene stops being one grey for every building and one grey for every road.

Since city objects M7 (2026-11-08) these class colours are `buildCity`'s
`palette: "class"`; by default an untagged building takes the seeded palette
of `building-palette.ts`, which shares `parseOsmColour` and `roofColour`.

## Public API

- `Rgb` — packed `0xrrggbb`.
- `buildingColour(tags, outline?): Rgb` — `building:colour` →
  `building:material` → `building=*` → default. With `outline` (a
  `building:part`'s outline tags) the part's own colour or material wins and
  only a part that says neither takes the outline's colour (bug 8).
- `roofColour(tags, outline?): Rgb | undefined` — `roof:colour`, the part's
  own first, then the outline's; `undefined` means the roof is drawn in the
  building's colour.
- `roadColour(tags): Rgb` — for the pedestrian classes (`PEDESTRIAN_CLASSES`:
  footway, path, steps, pedestrian, cycleway, platform) the class wins over
  `surface` (DEC-R7b-4); every other road takes `surface` → `highway=*` →
  default. A separately
  mapped sidewalk (`highway=footway` + `footway=sidewalk`) is `0xc6b49c`,
  lighter than the footway tan and still warm (objects plan M4a, O3's tone;
  the class still wins over `surface`); nothing is invented from `sidewalk=*`
  on a carriageway.
- `parseOsmColour(raw): Rgb | undefined` — `#rgb`, `#rrggbb`, and the colour
  names the corpus uses.
- `allBuildingColours()`, `allRoadColours()` — the palettes, for the tests.
- `luma(colour)`, `channelDistance(a, b)` — the measures the tests assert with.
- `REFERENCE_GROUND_RGB`, `DEFAULT_BUILDING_RGB`, `DEFAULT_ROAD_RGB`.

## Invariants & assumptions

- **Semantic class is the base, appearance tags are the override** (DEC-R4-5).
  `building=*` and `highway=*` are present by definition, so every feature gets
  a colour everywhere on earth; `building:colour`, `building:material` and
  `surface` are sparse and win where a mapper has said. Appearance-only was
  offered and rejected precisely because it would leave most of Cologne grey —
  which is the complaint.
- **Affordance-based colour was rejected.** The cells and region slabs own the
  heat ramp; a building palette that read as "scores" would be two colour
  languages in the same hues.
- **The heat ramp stays the loudest thing on screen** (§2 of the round-4 plan,
  R4-14). Enforced, not intended: every colour is asserted inside a lightness
  band and below a saturation ceiling.
- **Every road colour is contrast-checked against the ground.** DEC-R2-13
  measured this once — an asphalt-reasoned `0x2f333d` moved 77 pixels out of
  460 800 — and that measurement now covers the whole palette instead of one
  constant. The check found a real defect on its first run: a five-digit hex
  literal (`0x969aa`) that parsed as a dark blue.
- **A malformed colour falls through rather than parsing to black.** `#gggggg`
  is a real thing people type, and a black building reads as a rendering
  failure.
- **Only the colour names seen in use are resolved**, to their CSS values (bug
  8, accepted recommendation 2026-11-07). The OSM wiki's Key:building:colour prefers
  hex and allows basic names; the corpus has 3 108 colour values, 2 597 hex,
  and the table holds every name among the rest (`grey` 377 times down to
  `blue` twice). A name outside it still falls through, because a wrong colour
  is worse than the class default: it looks like a decision. `darkbrown` and
  `multiple` occur and are not CSS colours.
- **Every lookup table is a `Map`, never a plain object** (review finding 5,
  2026-11-07). Tag values are free text; on an object `constructor`,
  `__proto__` or `toString` find inherited members, and
  `building:colour=constructor` drew a building in NaN. Those names now fall
  through to the defaults like any unknown value.
- **A part's own colour tags beat its outline's; the class is always the
  outline's.** S3DB allows the colour tags on both, and a part that carries one
  says it differs. An untagged part takes the outline's colour, so an untagged
  cathedral is still one colour.
- **`REFERENCE_GROUND_RGB` is a copy of a value the demo owns**, which is the
  duplication this project distrusts — so the test asserts a _relationship_
  (contrast), and changing the demo's ground makes the test wrong rather than
  silently stale.

## Examples

```ts
buildingColour({ building: "house" }); // class
buildingColour({ "building:material": "brick" }); // material wins
buildingColour({ "building:colour": "#8899aa" }); // explicit wins
buildingColour({ "building:part": "yes" }, { "building:colour": "red" }); // 0xff0000
roofColour({}, { "roof:colour": "#aa3322" }); // 0xaa3322, from the outline
roadColour({ highway: "residential", surface: "gravel" }); // surface wins
roadColour({ highway: "footway", surface: "asphalt" }); // the class wins
```

## Tests

`feature-colours.test.ts` — the precedence of all three levels for both
builders, the fallbacks, the lightness band and saturation ceiling for both
palettes, the ground-contrast floor for every road colour, and the parser's
accepted and rejected forms.
