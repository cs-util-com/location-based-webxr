# `mesh/feature-colours.ts` — what colour a building or a road is

## Purpose

Turns OSM tags into a muted material colour for buildings and roads, so the
scene stops being one grey for every building and one grey for every road.

## Public API

- `Rgb` — packed `0xrrggbb`.
- `buildingColour(tags): Rgb` — `building:colour` → `building:material` →
  `building=*` → default.
- `roadColour(tags): Rgb` — `surface` → `highway=*` → default.
- `parseOsmColour(raw): Rgb | undefined` — `#rgb` and `#rrggbb` only.
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
- **CSS colour names are deliberately not resolved.** The list is 148 entries of
  which a handful appear in OSM, and a wrong colour is worse than the class
  default because it looks like a decision.
- **`REFERENCE_GROUND_RGB` is a copy of a value the demo owns**, which is the
  duplication this project distrusts — so the test asserts a _relationship_
  (contrast), and changing the demo's ground makes the test wrong rather than
  silently stale.

## Examples

```ts
buildingColour({ building: "house" }); // class
buildingColour({ "building:material": "brick" }); // material wins
buildingColour({ "building:colour": "#8899aa" }); // explicit wins
roadColour({ highway: "residential", surface: "gravel" }); // surface wins
```

## Tests

`feature-colours.test.ts` — the precedence of all three levels for both
builders, the fallbacks, the lightness band and saturation ceiling for both
palettes, the ground-contrast floor for every road colour, and the parser's
accepted and rejected forms.
